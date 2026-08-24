/*
<MODULE_CONTRACT>
  <purpose>RFC-0656: Stable-mode dispatcher — selects the correct stable normalizer by file extension. Returns null for unhandled extensions (caller falls back to byte hash).</purpose>
  <non-goals>
    <item>Do not implement individual normalizers — each lives in its own file.</item>
    <item>Do not handle semantic-mode normalization — that lives in normalizers/index.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0656: initial stable-mode dispatcher.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";

import { byteHash } from "../primitives.ts";
import { normalizePdf } from "./pdf.ts";
import { normalizeSourceMap } from "./sourcemap.ts";
import { normalizeJsonStable } from "./json-stable.ts";

export interface StableNormalizeResult {
  normalizer: string;
  hash: string;
}

const SOURCE_MAP_EXTENSIONS = new Set([".map"]);

export async function normalizeFileStable(
  absPath: string,
  bytes: Uint8Array,
  distRoot?: string,
): Promise<StableNormalizeResult | null> {
  const ext = path.extname(absPath).toLowerCase();
  const lowerPath = absPath.toLowerCase();

  if (ext === ".pdf") {
    const normalized = await normalizePdf(bytes);
    return { normalizer: "pdf", hash: byteHash(normalized) };
  }

  if (SOURCE_MAP_EXTENSIONS.has(ext)) {
    const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return { normalizer: "sourcemap", hash: normalizeSourceMap(content, distRoot) };
  }

  if (ext === ".json" || lowerPath.endsWith(".well-known/build-identity.json")) {
    const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return { normalizer: "json-stable", hash: normalizeJsonStable(content) };
  }

  return null;
}
