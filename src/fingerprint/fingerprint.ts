/*
<MODULE_CONTRACT>
<purpose>RFC-0364: Semantic fingerprint functions — file and tree fingerprinting with parser-backed normalizers.</purpose>
<non-goals>
  <item>Do not implement byte-level primitives — those live in primitives.ts.</item>
  <item>Do not implement file-type normalizers — those live in normalizers/.</item>
  <item>Do not define types — those live in types.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Split from primitives: byteHash/stableStringify/stableJsonHash moved to primitives.ts. This module now imports byteHash from there.</item>
  <item>Fix silent error swallowing in fingerprintTree: emit warnings when falling back to byte hash on parse failure.</item>
  <item>RFC-0380: fingerprintTree combined input uses paths relative to tree root, making hashes portable across machines.</item>
  <item>RFC-0656: add mode: "stable" — byte hashing with targeted normalization for PDF, source map, and JSON timestamp fields.</item>
</CHANGE_SUMMARY>
*/

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { byteHash } from "./primitives.ts";
import type { FingerprintFileResult, FingerprintOptions, FingerprintResult } from "./types.ts";
import { normalizeFile } from "./normalizers/index.ts";
import { normalizeFileStable } from "./normalizers/stable.ts";
import { normalizePathSep, shouldIgnore } from "./path-matcher.ts";

export async function fingerprintFile(
  filePath: string,
  options: FingerprintOptions,
): Promise<FingerprintFileResult> {
  const absPath = path.resolve(filePath);
  const bytes = await readFile(absPath);

  if (options.mode === "byte") {
    return {
      path: normalizePathSep(absPath),
      mode: "byte",
      normalizer: "binary",
      hash: byteHash(bytes),
    };
  }

  if (options.mode === "stable") {
    const distRoot = options.root ? path.resolve(options.root) : undefined;
    const stableResult = await normalizeFileStable(absPath, bytes, distRoot);
    if (stableResult) {
      return {
        path: normalizePathSep(absPath),
        mode: "stable",
        normalizer: stableResult.normalizer,
        hash: stableResult.hash,
      };
    }
    return {
      path: normalizePathSep(absPath),
      mode: "stable",
      normalizer: "binary",
      hash: byteHash(bytes),
    };
  }

  const result = await normalizeFile(absPath, bytes);
  return {
    path: normalizePathSep(absPath),
    mode: "semantic",
    normalizer: result.normalizer,
    hash: result.hash,
  };
}

async function walkTree(root: string, ignore: string[], acc: string[]): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    const rel = path.relative(process.cwd(), abs);
    if (shouldIgnore(rel, ignore)) continue;
    if (entry.isDirectory()) {
      await walkTree(abs, ignore, acc);
    } else if (entry.isFile()) {
      acc.push(abs);
    }
  }
}

export async function fingerprintTree(
  root: string,
  options: FingerprintOptions,
): Promise<FingerprintResult> {
  const absRoot = path.resolve(root);
  const ignore = options.ignore ?? [];
  const files: string[] = [];
  await walkTree(absRoot, ignore, files);
  files.sort();

  const results: FingerprintFileResult[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    try {
      const result = await fingerprintFile(file, options);
      results.push(result);
    } catch (err) {
      const relPath = normalizePathSep(path.relative(absRoot, file));
      const message = (err as Error).message?.slice(0, 200) ?? String(err);
      const warning = `fingerprintTree: ${options.mode} normalization failed for ${relPath} (${message}); falling back to byte hash`;
      console.warn(warning);
      warnings.push(warning);
      const bytes = await readFile(file);
      results.push({
        path: normalizePathSep(file),
        mode: "byte",
        normalizer: "binary",
        hash: byteHash(bytes),
      });
    }
  }

  const combinedInput = results
    .map((r) => {
      const rel = normalizePathSep(path.relative(absRoot, r.path));
      return `${rel}\n${r.hash}`;
    })
    .join("\n");
  return {
    algorithm: "sha256",
    mode: options.mode,
    value: byteHash(combinedInput),
    files: results,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
