/*
<MODULE_CONTRACT>
<purpose>
RFC-0390: Command-result cache helpers. Computes cache keys from declared
`reads` file hashes and command module source hashes, and provides get/set
helpers for storing and retrieving KernelExecutionReport objects in the
`command_results` cache namespace. All hashing uses @warpgogol/fingerprint (DNA-53).
</purpose>
<non-goals>
  <item>Do not implement cache storage — that lives in cache-layer.ts and sqlite-cache-layer.ts.</item>
  <item>Do not implement pipeline execution logic — that lives in runtime/execute-pipeline.ts.</item>
  <item>Do not validate `reads` declarations — that lives in command.reads.validate.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Command results are cached by input hash — identical inputs skip re-execution.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1127: step 1 — cache barrel + parse fix

Add ./kernel/cache subpath export (narrow barrel: createCacheLayer, computeModuleHash, key helpers). Fix parseCommandResultCacheKey truncating algo-prefixed hashes (sha256:hex) — list() returned garbage moduleHash for all real keys.</item>
  <item>RFC-1133: flagsHash in cache key + schema v2

CommandResultCacheKey gains flagsHash (stableJsonHash over cache-visible resolved flags); schemaVersion bumps to 2 so v1 keys orphan naturally. get/set helpers accept the narrow KernelResultCacheStore port from werkstatt-shared so the executor-level cache block in executeRegisteredCommand can run without a concrete CacheLayer import.</item>
  <item>RFC-1133: cache direct executeKernelCommand executions with flag-keyed results</item>
  <history>RFC-0390, RFC-0637, RFC-0685</history>
</CHANGE_SUMMARY>
*/

import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Dirent } from "node:fs";
import picomatch from "picomatch";

import { byteHash, stableJsonHash } from "@warpgogol/werkstatt-engine/fingerprint";
import { fingerprintFile, fingerprintTree } from "@warpgogol/werkstatt-engine/fingerprint/semantic";

import type {
  KernelExecutionReport,
  KernelResultCacheStore,
} from "@warpgogol/werkstatt-shared/kernel";
import type { WorkspaceTreeIndex } from "./workspace-tree-index.ts";
import { filterTreeIndex } from "./workspace-tree-index.ts";

export const COMMAND_RESULT_CACHE_NAMESPACE = "command_results";
export const COMMAND_RESULT_CACHE_SCHEMA_VERSION = 2;

export interface CommandResultCacheKey {
  schemaVersion: number;
  commandName: string;
  siteName: string | null;
  inputsHash: string;
  moduleHash: string;
  /** RFC-1133: stableJsonHash over cache-visible resolved flags ("" when none). */
  flagsHash: string;
}

export interface InputsMetadataEntry {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface CachedCommandResultEntry {
  report: KernelExecutionReport;
  inputsMetadata?: InputsMetadataEntry[];
  inputsHash?: string;
}

const _BYTE_MODE_EXTENSIONS = new Set([".md", ".yaml", ".yml", ".json", ".jsonc", ".txt"]);

const SEMANTIC_MODE_EXTENSIONS = new Set([".ts", ".tsx", ".astro", ".css", ".js", ".mjs"]);

function selectFingerprintMode(absPath: string): "byte" | "semantic" {
  const ext = absPath.slice(absPath.lastIndexOf(".")).toLowerCase();
  if (SEMANTIC_MODE_EXTENSIONS.has(ext)) return "semantic";
  return "byte";
}

/**
 * RFC-1028: Build a composite string key from a CommandResultCacheKey.
 * Format: `${schemaVersion}:${commandName}:${siteName}:${inputsHash}:${moduleHash}:${flagsHash}`
 * (flagsHash appended last by RFC-1133). This replaces the previous
 * stableJsonHash approach — the composite key is human-readable and enables
 * SQL LIKE filtering by commandName in list().
 */
export function buildCommandResultCacheKey(key: CommandResultCacheKey): string {
  return [
    key.schemaVersion,
    key.commandName,
    key.siteName ?? "",
    key.inputsHash,
    key.moduleHash,
    key.flagsHash,
  ].join(":");
}

/**
 * RFC-1028: Parse a composite cache key back into its components.
 * Returns null if the key does not match the expected format.
 */
export function parseCommandResultCacheKey(
  namespace: string,
  key: string,
): {
  commandName: string;
  siteName: string | null;
  inputsHash: string;
  moduleHash: string;
  flagsHash: string;
} | null {
  if (namespace !== COMMAND_RESULT_CACHE_NAMESPACE) return null;
  const parts = key.split(":");
  if (parts.length < 6) return null;
  const [, commandName, siteName] = parts;
  // Hashes are "algo:hex" (e.g. sha256:abc…) — each may occupy two segments.
  // Parse from the right: flagsHash, then moduleHash, then the remainder is
  // inputsHash (RFC-1133 appended flagsHash as the last component).
  const rest = parts.slice(3);
  const isAlgoPrefix = (s: string) => /^(sha\d+|blake2[bs]?|md5)$/.test(s);
  const takeHash = (segments: string[]): { hash: string; rest: string[] } | null => {
    if (segments.length === 0) return null;
    if (segments.length >= 2 && isAlgoPrefix(segments[segments.length - 2])) {
      return { hash: segments.slice(-2).join(":"), rest: segments.slice(0, -2) };
    }
    return { hash: segments[segments.length - 1], rest: segments.slice(0, -1) };
  };
  const flags = takeHash(rest);
  if (!flags) return null;
  const mod = takeHash(flags.rest);
  if (!mod) return null;
  const inputsHash = mod.rest.join(":");
  // flagsHash may legitimately be "" (no cache-visible flags) — the trailing
  // empty segment is part of the v2 format. inputsHash/moduleHash may not.
  if (!inputsHash || !mod.hash) return null;
  return {
    commandName,
    siteName: siteName || null,
    inputsHash,
    moduleHash: mod.hash,
    flagsHash: flags.hash,
  };
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Resolve `<app>` token in a read pattern relative to the base directory,
 * then return the workspace-root-relative POSIX path.
 */
function resolvePattern(pattern: string, baseDir: string, workspaceRoot: string): string {
  const resolved = pattern.replace("<app>", toPosix(relative(workspaceRoot, baseDir)));
  return resolved;
}

/**
 * Expand picomatch globs relative to the workspace root and return matching
 * absolute file paths. When a tree index is provided, filters in-memory
 * instead of walking the filesystem (RFC-0685).
 */
async function expandGlobs(
  patterns: string[],
  baseDir: string,
  workspaceRoot: string,
  treeIndex?: WorkspaceTreeIndex,
): Promise<string[]> {
  if (treeIndex) {
    return filterTreeIndex(treeIndex, patterns, baseDir, workspaceRoot);
  }

  const resolvedPatterns = patterns.map((p) => resolvePattern(p, baseDir, workspaceRoot));
  const isMatch = picomatch(resolvedPatterns, { dot: true, nocase: false });
  const matched = new Set<string>();

  // fs.walk.lint: allow — this walker matches files against picomatch glob
  // patterns relative to the workspace root, a contract collectFiles does not support (RFC-0390).
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = toPosix(relative(workspaceRoot, abs));
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile() && isMatch(rel)) {
        matched.add(abs);
      }
    }
  }

  await walk(workspaceRoot);
  return [...matched].sort();
}

/**
 * Compute a deterministic hash of all files matching the declared `reads`
 * patterns. Uses @warpgogol/fingerprint semantic mode for source file types
 * and byte mode for content files. Returns a stable composite hash and
 * the metadata array for mtime fast path (RFC-0685).
 *
 * Returns a constant hash for empty `reads` (should not be called with empty
 * reads in practice — the pipeline executor checks cacheable/reads first).
 */
export async function computeInputsHash(
  reads: string[],
  baseDir: string,
  workspaceRoot: string,
  treeIndex?: WorkspaceTreeIndex,
): Promise<{ hash: string; metadata: InputsMetadataEntry[] }> {
  if (reads.length === 0) {
    return { hash: stableJsonHash({ reads: [] }), metadata: [] };
  }

  const files = await expandGlobs(reads, baseDir, workspaceRoot, treeIndex);
  const hashes: { path: string; hash: string }[] = [];
  const metadata: InputsMetadataEntry[] = [];
  for (const abs of files) {
    const rel = toPosix(relative(workspaceRoot, abs));
    const mode = selectFingerprintMode(abs);
    let result;
    try {
      result = await fingerprintFile(abs, { mode });
    } catch {
      continue;
    }
    hashes.push({ path: rel, hash: result.hash });
    const s = await stat(abs);
    metadata.push({ path: rel, mtimeMs: s.mtimeMs, size: s.size });
  }
  metadata.sort((a, b) => a.path.localeCompare(b.path));
  return { hash: stableJsonHash({ files: hashes }), metadata };
}

/**
 * Compute a deterministic hash of a command module's source directory.
 * Uses @warpgogol/fingerprint fingerprintTree in semantic mode.
 * The caller should cache this per-package per-pipeline-run.
 *
 * RFC-0637: when `modulePaths` is provided and non-empty, fingerprints only
 * the listed paths (files and/or directories relative to `moduleSrcDir`)
 * instead of the full `src/` directory. Non-existent paths are silently
 * skipped. When `modulePaths` is absent or empty, falls back to full `src/`
 * directory fingerprint (backward compatible).
 */
export async function computeModuleHash(
  moduleSrcDir: string,
  modulePaths?: string[],
): Promise<string> {
  if (modulePaths && modulePaths.length > 0) {
    const hashes: string[] = [];
    for (const p of modulePaths) {
      const abs = join(moduleSrcDir, p);
      if (!existsSync(abs)) continue;
      const s = await stat(abs);
      if (s.isDirectory()) {
        const result = await fingerprintTree(abs, {
          mode: "semantic",
          ignore: ["__tests__", "node_modules", "dist"],
        });
        hashes.push(`${p}:${result.value}`);
      } else {
        const result = await fingerprintFile(abs, { mode: "semantic" });
        hashes.push(`${p}:${result.hash}`);
      }
    }
    return stableJsonHash({ paths: hashes });
  }
  try {
    const result = await fingerprintTree(moduleSrcDir, {
      mode: "semantic",
      ignore: ["__tests__", "node_modules", "dist"],
    });
    return result.value;
  } catch {
    return byteHash(`module-hash-fallback:${moduleSrcDir}`);
  }
}

/**
 * Retrieve a cached command result. Returns null on miss, unavailable cache,
 * or schema version mismatch. Sets `cached: true` on the returned report.
 *
 * RFC-0685: the cache data payload may be a wrapper
 * { report, inputsMetadata, inputsHash } or a legacy bare KernelExecutionReport.
 * The wrapper is detected by checking for the `report` field.
 */
export async function getCachedCommandResult(
  cache: KernelResultCacheStore,
  key: CommandResultCacheKey,
): Promise<CachedCommandResultEntry | null> {
  if (!cache.available) return null;

  const cacheKey = buildCommandResultCacheKey(key);
  const entry = await cache.get(COMMAND_RESULT_CACHE_NAMESPACE, cacheKey);
  if (!entry) return null;

  const data = entry.data;
  if (!data || typeof data !== "object") return null;

  // RFC-0685: detect wrapper format vs legacy bare report.
  if ("report" in data && typeof data.report === "object") {
    const wrapped = data as CachedCommandResultEntry;
    if (!wrapped.report || typeof wrapped.report !== "object") return null;
    return {
      report: { ...wrapped.report, cached: true },
      inputsMetadata: wrapped.inputsMetadata,
      inputsHash: wrapped.inputsHash,
    };
  }

  // Legacy: bare KernelExecutionReport.
  const report = data as KernelExecutionReport;
  if (!report.commandName) return null;
  return { report: { ...report, cached: true } };
}

/**
 * Store a command result in the cache. Only called for successful (ok: true)
 * results — the pipeline executor must not call this for failed commands.
 *
 * RFC-0685: stores a wrapper { report, inputsMetadata, inputsHash } in the
 * cache data payload to support the mtime fast path on subsequent reads.
 */
export async function setCachedCommandResult(
  cache: KernelResultCacheStore,
  key: CommandResultCacheKey,
  report: KernelExecutionReport,
  inputsMetadata?: InputsMetadataEntry[],
): Promise<void> {
  if (!cache.available) return;

  const cacheKey = buildCommandResultCacheKey(key);
  const mtime = Date.now();
  const wrapper: CachedCommandResultEntry = {
    report,
    inputsMetadata,
    inputsHash: key.inputsHash,
  };
  const contentHash = stableJsonHash({
    commandName: report.commandName,
    ok: report.ok,
    exitCode: report.exitCode,
  });
  await cache.set(COMMAND_RESULT_CACHE_NAMESPACE, cacheKey, wrapper, mtime, contentHash);
}
