/*
<MODULE_CONTRACT>
  <purpose>RFC-0656: Source map stable normalizer — normalizes sources paths to relative and strips sourceRoot before hashing.</purpose>
  <non-goals>
    <item>Do not alter source map content fields other than sources and sourceRoot.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0656: initial source map stable normalizer.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";

import { stableJsonHash } from "../primitives.ts";

const NON_DETERMINISTIC_KEYS = new Set(["createdAt", "buildTimestamp", "generatedAt"]);

interface SourceMap {
  version: number;
  sources?: string[];
  sourceRoot?: string;
  sourcesContent?: string[];
  names?: string[];
  mappings?: string;
  file?: string;
  [key: string]: unknown;
}

function stripTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTimestamps);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !NON_DETERMINISTIC_KEYS.has(key))
        .map(([key, nested]) => [key, stripTimestamps(nested)]),
    );
  }
  return value;
}

export function normalizeSourceMap(content: string, distRoot?: string): string {
  const map = JSON.parse(content) as SourceMap;

  delete map.sourceRoot;

  if (map.sources) {
    map.sources = map.sources.map((src) => {
      if (path.isAbsolute(src)) {
        const rel = path.relative(distRoot ?? process.cwd(), src);
        return normalizePathSep(rel);
      }
      return normalizePathSep(src);
    });
  }

  return stableJsonHash(stripTimestamps(map));
}

function normalizePathSep(p: string): string {
  return p.split(path.sep).join("/");
}
