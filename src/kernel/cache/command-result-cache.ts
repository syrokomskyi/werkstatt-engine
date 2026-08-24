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
<CHANGE_SUMMARY>
  <item>RFC-0390: initial implementation — COMMAND_RESULT_CACHE_NAMESPACE, CommandResultCacheKey, buildCommandResultCacheKey, computeInputsHash, computeModuleHash, getCachedCommandResult, setCachedCommandResult.</item>
  <item>RFC-0637: add modulePaths parameter to computeModuleHash for granular per-command module hashing.</item>
  <item>RFC-0685: add tree index support to expandGlobs, byte-mode selection per extension in computeInputsHash, inputsMetadata sidecar in cache entries, wrapper format for getCachedCommandResult/setCachedCommandResult.</item>
</CHANGE_SUMMARY>
*/

import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Dirent } from "node:fs";
import picomatch from "picomatch";

import { byteHash, stableJsonHash } from "@warpgogol/werkstatt-engine/fingerprint";
import { fingerprintFile, fingerprintTree } from "@warpgogol/werkstatt-engine/fingerprint/semantic";

import type { CacheLayer } from "./cache-layer.ts";
import type { KernelExecutionReport } from "../types.ts";
import type { WorkspaceTreeIndex } from "./workspace-tree-index.ts";
import { filterTreeIndex } from "./workspace-tree-index.ts";

export const COMMAND_RESULT_CACHE_NAMESPACE = "command_results";
export const COMMAND_RESULT_CACHE_SCHEMA_VERSION = 1;

export interface CommandResultCacheKey {
  schemaVersion: number;
  commandName: string;
  siteName: string | null;
  inputsHash: string;
  moduleHash: string;
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
 * Build a stable string key from a CommandResultCacheKey for CacheLayer.get/set.
 */
export function buildCommandResultCacheKey(key: CommandResultCacheKey): string {
  return stableJsonHash({
    v: key.schemaVersion,
    cmd: key.commandName,
    site: key.siteName,
    in: key.inputsHash,
    mod: key.moduleHash,
  });
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
  cache: CacheLayer,
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
  cache: CacheLayer,
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
