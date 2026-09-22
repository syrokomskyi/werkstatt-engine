/*
<MODULE_CONTRACT>
<purpose>
RFC-1133: shared command-result cache block for the kernel executor. Owns the
`command_results` read/write consumed by `executeRegisteredCommand` — the single
choke point covering direct `executeKernelCommand` calls and both pipeline
executors — plus the flagsHash rule (CACHE_INVISIBLE_FLAGS denylist), the
RFC-0685 mtime fast path, and the RFC-1130 cacheBypassFlags gate.
</purpose>
<non-goals>
  <item>Do not implement cache storage — that lives in kernel/cache/cache-layer.ts and sqlite-cache-layer.ts.</item>
  <item>Do not implement pipeline scheduling or step orchestration — that lives in execute-pipeline.ts.</item>
  <item>Do not persist cross-pipeline cache hits — persistCacheHits stays in execute-pipeline.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Cache read/write runs inside executeRegisteredCommand (single choke point, ADR-0087 precedent); pipeline executors pass per-run structures via context.resultCache instead of calling the helpers directly.</item>
  <item>flagsHash uses a denylist (CACHE_INVISIBLE_FLAGS) over resolved input.flags — presentation and bypass universals never fragment the cache, while an unaliasable --site on a workspace command stays keyed.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1133: module created — isCommandCacheable, hasCacheBypassFlag, tryMtimeFastPath, and the read/write orchestrators relocated from execute-pipeline.ts; computeFlagsHash + CACHE_INVISIBLE_FLAGS added; key gains flagsHash (schema v2).</item>
  <item>RFC-1133: cache direct executeKernelCommand executions with flag-keyed results</item>
</CHANGE_SUMMARY>
*/

import { access } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { stableJsonHash } from "@warpgogol/werkstatt-engine/fingerprint";
import type {
  KernelCommandDefinition,
  KernelExecutionReport,
  KernelResultCacheContext,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";

import { createCacheLayer } from "../cache/cache-layer.ts";
import {
  COMMAND_RESULT_CACHE_SCHEMA_VERSION,
  computeInputsHash,
  computeModuleHash,
  getCachedCommandResult,
  setCachedCommandResult,
  type CommandResultCacheKey,
  type InputsMetadataEntry,
} from "../cache/command-result-cache.ts";
import { filterTreeIndex } from "../cache/workspace-tree-index.ts";
import { deriveModuleBasePath } from "./registry.ts";

/**
 * RFC-1133: universal flags that never enter flagsHash. Presentation flags
 * (json/quiet/verbose/help) must not fragment the cache; bypass flags
 * (dry-run/force) are handled by the read/write gates, and `force` in
 * particular must stay out so a --force write refreshes the entry that
 * normal runs read (DNA-93). `root` is a locator, not a result input.
 *
 * `site`/`all` are deliberately NOT invisible: workspace-scoped commands carry
 * siteName: null in the key, so a --site value that survived alias resolution
 * must be keyed.
 */
export const CACHE_INVISIBLE_FLAGS: ReadonlySet<string> = new Set([
  "json",
  "quiet",
  "verbose",
  "help",
  "dry-run",
  "force",
  "root",
]);

/**
 * RFC-1133: stable hash over the cache-visible resolved flags.
 * Returns "" when no visible flags are present.
 */
export function computeFlagsHash(flags: Record<string, unknown>): string {
  const visible: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(flags)) {
    if (!CACHE_INVISIBLE_FLAGS.has(name)) visible[name] = value;
  }
  return Object.keys(visible).length === 0 ? "" : stableJsonHash(visible);
}

/**
 * RFC-0390: a command is eligible for caching when `cacheable !== false` AND
 * it declares non-empty `reads`. Commands with `cacheable: false` or without
 * `reads` are always executed.
 */
export function isCommandCacheable(command: KernelCommandDefinition): boolean {
  if (command.cacheable === false) return false;
  const reads = command.reads ?? [];
  return reads.length > 0;
}

/**
 * RFC-1130: true when argv contains a flag listed in the command's
 * `cacheBypassFlags` (`--name` or `--name=value` forms). Flags that reduce
 * coverage (e.g. `--rfc`) must bypass both the cache read and the cache write
 * so a filtered run can neither serve a stale full-run report nor poison the
 * full-run entry.
 */
export function hasCacheBypassFlag(command: KernelCommandDefinition, argv: string[]): boolean {
  const names = command.cacheBypassFlags ?? [];
  return names.some((n) => argv.some((a) => a === `--${n}` || a.startsWith(`--${n}=`)));
}

/**
 * Everything the cache block needs for one invocation, computed once by
 * executeRegisteredCommand from the final resolved input — post
 * resolveSiteFlagAlias, post pipeline --site/--system injection — so read and
 * write always see identical flags.
 */
export interface CommandResultCacheCall {
  command: KernelCommandDefinition;
  /** Raw argv (pre-resolution) — used only for the cacheBypassFlags check. */
  argv: string[];
  /** Resolved input.flags — hashed via computeFlagsHash. */
  flags: Record<string, unknown>;
  baseDir: string;
  workspaceRoot: string;
  siteName: string | null;
  force: boolean;
  dryRun: boolean;
}

export interface ResolvedResultCache {
  cache: KernelResultCacheContext;
  /** True when this call opened the layer — the caller must close() it. */
  owned: boolean;
}

/**
 * Resolve the cache carrier for one command execution. Returns null when the
 * invocation can neither read nor write the cache (non-cacheable command,
 * dry-run, or a cacheBypassFlags hit) — in that case no layer is opened at
 * all. `--force` still resolves: the read is skipped but the write refreshes
 * the entry (DNA-93).
 */
export async function resolveResultCache(
  context: KernelRuntimeContext,
  call: CommandResultCacheCall,
): Promise<ResolvedResultCache | null> {
  if (!isCommandCacheable(call.command)) return null;
  if (call.dryRun) return null;
  if (hasCacheBypassFlag(call.command, call.argv)) return null;
  if (context.resultCache) return { cache: context.resultCache, owned: false };
  const layer = await createCacheLayer(context.workspaceRoot);
  return { cache: { layer, moduleHashCache: new Map() }, owned: true };
}

/**
 * RFC-0390 + RFC-0685 + RFC-1133: attempt to read a cached result.
 * Returns the cached report (with `cached: true`) or null on miss.
 * Skips when `dryRun` or `force` is set or when the layer is unavailable.
 */
export async function readCommandResult(
  cache: KernelResultCacheContext,
  call: CommandResultCacheCall,
): Promise<KernelExecutionReport | null> {
  if (call.dryRun || call.force) return null;
  if (!isCommandCacheable(call.command)) return null;
  if (hasCacheBypassFlag(call.command, call.argv)) return null;
  if (!cache.layer.available) return null;

  const reads = call.command.reads ?? [];
  const flagsHash = computeFlagsHash(call.flags);
  const moduleSrcDir = resolveModuleSrcDir(call.command, call.workspaceRoot);
  const moduleHashCache = cache.moduleHashCache ?? new Map<string, string>();

  // RFC-0685: mtime fast path — requires the pipeline's tree index.
  if (cache.treeIndex) {
    const fastPathResult = await tryMtimeFastPath(
      cache,
      call.command,
      reads,
      call.baseDir,
      call.workspaceRoot,
      call.siteName,
      moduleSrcDir,
      moduleHashCache,
      flagsHash,
    );
    if (fastPathResult) return fastPathResult;
  }

  const { hash: inputsHash } = await computeInputsHash(
    reads,
    call.baseDir,
    call.workspaceRoot,
    cache.treeIndex,
  );
  const moduleHash = await getOrComputeModuleHash(moduleSrcDir, call.command, moduleHashCache);

  const key: CommandResultCacheKey = {
    schemaVersion: COMMAND_RESULT_CACHE_SCHEMA_VERSION,
    commandName: call.command.name,
    siteName: call.siteName,
    inputsHash,
    moduleHash,
    flagsHash,
  };

  const entry = await getCachedCommandResult(cache.layer, key);
  if (!entry?.report) return null;

  // RFC-1057: verify output files still exist before trusting cache.
  const writes = call.command.writes ?? [];
  if (writes.length > 0) {
    for (const writePath of writes) {
      const abs = join(call.baseDir, writePath);
      try {
        await access(abs);
      } catch {
        return null;
      }
    }
  }

  return entry.report;
}

/**
 * RFC-0390 + RFC-0685 + RFC-1133: store a successful command result.
 * Only stores when `ok: true`, not `dryRun`, and the command is cacheable.
 * On `--force`, still stores (refreshing entries). The `command_results_meta`
 * sidecar format is unchanged — inputsHash is flag-independent, so flag
 * variants share the entry benignly.
 */
export async function writeCommandResult(
  cache: KernelResultCacheContext,
  call: CommandResultCacheCall,
  report: KernelExecutionReport,
): Promise<void> {
  if (call.dryRun) return;
  if (!report.ok) return;
  if (!isCommandCacheable(call.command)) return;
  if (hasCacheBypassFlag(call.command, call.argv)) return;
  if (!cache.layer.available) return;

  const reads = call.command.reads ?? [];
  const flagsHash = computeFlagsHash(call.flags);
  const { hash: inputsHash, metadata } = await computeInputsHash(
    reads,
    call.baseDir,
    call.workspaceRoot,
    cache.treeIndex,
  );
  const moduleSrcDir = resolveModuleSrcDir(call.command, call.workspaceRoot);
  const moduleHash = await getOrComputeModuleHash(
    moduleSrcDir,
    call.command,
    cache.moduleHashCache ?? new Map<string, string>(),
  );

  const key: CommandResultCacheKey = {
    schemaVersion: COMMAND_RESULT_CACHE_SCHEMA_VERSION,
    commandName: call.command.name,
    siteName: call.siteName,
    inputsHash,
    moduleHash,
    flagsHash,
  };

  await setCachedCommandResult(cache.layer, key, report, metadata);

  // RFC-0685: store metadata-to-inputsHash mapping for the mtime fast path.
  if (metadata.length > 0) {
    const metadataHash = stableJsonHash({ metadata });
    const metaKey = `meta:${call.command.name}:${call.siteName ?? ""}:${metadataHash}`;
    await cache.layer.set("command_results_meta", metaKey, inputsHash, Date.now(), inputsHash);
  }
}

/**
 * RFC-1028: resolve the module source dir from command.modulePath.
 * Falls back to a constant hash when modulePath is absent (legacy modules).
 */
function resolveModuleSrcDir(command: KernelCommandDefinition, workspaceRoot: string): string {
  return command.modulePath
    ? join(workspaceRoot, deriveModuleBasePath(command.modulePath) ?? "")
    : join(workspaceRoot, "packages", "werkstatt-site", "src");
}

/**
 * RFC-0637: resolve the module hash from the per-run cache, computing on miss.
 */
async function getOrComputeModuleHash(
  moduleSrcDir: string,
  command: KernelCommandDefinition,
  moduleHashCache: Map<string, string>,
): Promise<string> {
  const moduleHashCacheKey = `${moduleSrcDir}:${command.modulePaths?.join(",") ?? ""}`;
  let moduleHash = moduleHashCache.get(moduleHashCacheKey);
  if (!moduleHash) {
    moduleHash = await computeModuleHash(moduleSrcDir, command.modulePaths);
    moduleHashCache.set(moduleHashCacheKey, moduleHash);
  }
  return moduleHash;
}

/**
 * RFC-0685: mtime fast path. Computes current file metadata from the tree
 * index, looks up the stored inputsHash via the command_results_meta sidecar,
 * and returns the cached report without fingerprinting when it matches.
 */
async function tryMtimeFastPath(
  cache: KernelResultCacheContext,
  command: KernelCommandDefinition,
  reads: string[],
  baseDir: string,
  workspaceRoot: string,
  siteName: string | null,
  moduleSrcDir: string,
  moduleHashCache: Map<string, string>,
  flagsHash: string,
): Promise<KernelExecutionReport | null> {
  const treeIndex = cache.treeIndex;
  if (!treeIndex) return null;

  // Expand globs using tree index to get current file list with metadata.
  const files = filterTreeIndex(treeIndex, reads, baseDir, workspaceRoot);
  if (files.length === 0) return null;

  // Build current metadata from tree index.
  const currentMetadata: InputsMetadataEntry[] = [];
  for (const abs of files) {
    const rel = relative(workspaceRoot, abs).split(sep).join("/");
    const entry = treeIndex.get(rel);
    if (!entry) return null; // file not in index — can't use fast path
    currentMetadata.push({ path: rel, mtimeMs: entry.mtimeMs, size: entry.size });
  }
  currentMetadata.sort((a, b) => a.path.localeCompare(b.path));

  // Compute a hash from the metadata to use as a lookup key.
  const metadataHash = stableJsonHash({ metadata: currentMetadata });

  // Look up the metadata-to-inputsHash mapping.
  const metaKey = `meta:${command.name}:${siteName ?? ""}:${metadataHash}`;
  const metaEntry = await cache.layer.get("command_results_meta", metaKey);
  if (!metaEntry) return null;

  const storedInputsHash = metaEntry.data as string;
  if (typeof storedInputsHash !== "string") return null;

  const moduleHash = await getOrComputeModuleHash(moduleSrcDir, command, moduleHashCache);

  const key: CommandResultCacheKey = {
    schemaVersion: COMMAND_RESULT_CACHE_SCHEMA_VERSION,
    commandName: command.name,
    siteName,
    inputsHash: storedInputsHash,
    moduleHash,
    flagsHash,
  };

  const entry = await getCachedCommandResult(cache.layer, key);
  if (!entry?.report) return null;

  // RFC-1057: verify output files still exist before trusting cache.
  const writes = command.writes ?? [];
  if (writes.length > 0) {
    for (const writePath of writes) {
      const abs = join(baseDir, writePath);
      try {
        await access(abs);
      } catch {
        return null;
      }
    }
  }

  return entry.report;
}
