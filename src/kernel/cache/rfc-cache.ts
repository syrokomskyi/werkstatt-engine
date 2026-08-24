/*
<MODULE_CONTRACT>
<purpose>
RFC-0382: RFC-specific cache helpers. Reads and fills cached RFC frontmatter
entries using the CacheLayer interface. Content hashing uses @warpgogol/fingerprint
(DNA-53). Cache invalidation is per-file via mtime + content hash.
</purpose>
<non-goals>
  <item>Do not implement cache storage — that lives in cache-layer.ts and sqlite-cache-layer.ts.</item>
  <item>Do not validate RFC frontmatter — that lives in handlers/validate-rules.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0382: initial implementation — RfcCacheEntry, getCachedRfcEntries, rfcCacheEntryToParsedRfc.</item>
  <item>RFC-0382 post-review: check schemaVersion during cache invalidation; use top-level readFile import.</item>
</CHANGE_SUMMARY>
*/

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";

import type { CacheLayer } from "./cache-layer.ts";
import { listRfcFiles, parseRfcFile, type ParsedRfc } from "@warpgogol/forge/os/rfc";

export const RFC_CACHE_NAMESPACE = "rfc_entries";
export const RFC_CACHE_SCHEMA_VERSION = 1;

export interface RfcCacheEntry {
  id: string;
  fileName: string;
  status: string;
  kind: string;
  scope: string;
  title: string;
  owners: string[];
  createdAt: string;
  updatedAt: string;
  implementedAt: string | null;
  closedAt: string | null;
  supersedes: string[];
  supersededBy: string | null;
  amends: string[];
  amendedBy: string[];
  related: string[];
  satisfies: string[];
  commandsProposed: string[];
  commandsAdded: string[];
  commandsChanged: string[];
  commandsRemoved: string[];
  frontmatterRaw: string;
  body: string;
  bodyLength: number;
  schemaVersion: number;
  mtime: number;
  contentHash: string;
}

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStr(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function buildRfcCacheEntry(
  fileName: string,
  parsed: ParsedRfc,
  mtime: number,
  contentHash: string,
): RfcCacheEntry {
  const fm = parsed.frontmatter;
  const commands = (fm["commands"] ?? {}) as Record<string, unknown>;
  return {
    id: str(fm["id"]),
    fileName,
    status: str(fm["status"]),
    kind: str(fm["kind"]),
    scope: str(fm["scope"]),
    title: str(fm["title"]),
    owners: arr(fm["owners"]),
    createdAt: str(fm["createdAt"]),
    updatedAt: str(fm["updatedAt"]),
    implementedAt: nullableStr(fm["implementedAt"]),
    closedAt: nullableStr(fm["closedAt"]),
    supersedes: arr(fm["supersedes"]),
    supersededBy: nullableStr(fm["supersededBy"]),
    amends: arr(fm["amends"]),
    amendedBy: arr(fm["amendedBy"]),
    related: arr(fm["related"]),
    satisfies: arr(fm["satisfies"]),
    commandsProposed: arr(commands["proposed"] ?? fm["commandsProposed"]),
    commandsAdded: arr(commands["added"] ?? fm["commandsAdded"]),
    commandsChanged: arr(commands["changed"] ?? fm["commandsChanged"]),
    commandsRemoved: arr(commands["removed"] ?? fm["commandsRemoved"]),
    frontmatterRaw: JSON.stringify(fm),
    body: parsed.body,
    bodyLength: parsed.body.length,
    schemaVersion: RFC_CACHE_SCHEMA_VERSION,
    mtime,
    contentHash,
  };
}

export function rfcCacheEntryToParsedRfc(entry: RfcCacheEntry): {
  fileName: string;
  parsed: ParsedRfc;
} {
  return {
    fileName: entry.fileName,
    parsed: {
      frontmatter: JSON.parse(entry.frontmatterRaw) as Record<string, unknown>,
      body: entry.body,
    },
  };
}

async function getCachedEntryForFile(
  cache: CacheLayer,
  rfcDirPath: string,
  fileName: string,
  forceRefresh: boolean,
): Promise<RfcCacheEntry | undefined> {
  if (!forceRefresh && cache.available) {
    const cached = await cache.get(RFC_CACHE_NAMESPACE, fileName);
    if (cached) {
      const cachedEntry = cached.data as RfcCacheEntry;
      // Check schema version + mtime + content hash for invalidation
      if (cachedEntry.schemaVersion !== RFC_CACHE_SCHEMA_VERSION) {
        // Schema changed — force reparse by falling through to cache miss
      } else {
        const filePath = join(rfcDirPath, fileName);
        try {
          const fileStat = await stat(filePath);
          if (
            fileStat.mtimeMs === cachedEntry.mtime &&
            cachedEntry.contentHash === cached.contentHash
          ) {
            return cachedEntry;
          }
        } catch {
          // File may have been deleted — return undefined to skip
          return undefined;
        }
      }
    }
  }

  // Cache miss or force refresh — read and parse the file
  const filePath = join(rfcDirPath, fileName);
  let fileContent: string;
  let mtime: number;
  try {
    fileContent = await readFile(filePath, "utf-8");
    const fileStat = await stat(filePath);
    mtime = fileStat.mtimeMs;
  } catch {
    return undefined;
  }

  const parsed = parseRfcFile(fileContent);
  const contentHash = await byteHashFile(filePath);
  const entry = buildRfcCacheEntry(fileName, parsed, mtime, contentHash);

  if (cache.available) {
    await cache.set(RFC_CACHE_NAMESPACE, fileName, entry, mtime, contentHash);
  }

  return entry;
}

export async function getCachedRfcEntries(
  cache: CacheLayer,
  rfcDirPath: string,
  forceRefresh = false,
): Promise<Map<string, RfcCacheEntry>> {
  const files = await listRfcFiles(rfcDirPath);
  const entries = new Map<string, RfcCacheEntry>();

  for (const fileName of files) {
    const entry = await getCachedEntryForFile(cache, rfcDirPath, fileName, forceRefresh);
    if (entry) {
      entries.set(entry.id, entry);
    }
  }

  return entries;
}

export async function getCachedRfcEntriesByFile(
  cache: CacheLayer,
  rfcDirPath: string,
  forceRefresh = false,
): Promise<Map<string, RfcCacheEntry>> {
  const files = await listRfcFiles(rfcDirPath);
  const entries = new Map<string, RfcCacheEntry>();

  for (const fileName of files) {
    const entry = await getCachedEntryForFile(cache, rfcDirPath, fileName, forceRefresh);
    if (entry) {
      entries.set(fileName, entry);
    }
  }

  return entries;
}

export async function getCachedRfcEntry(
  cache: CacheLayer,
  rfcDirPath: string,
  fileName: string,
  forceRefresh = false,
): Promise<RfcCacheEntry | undefined> {
  return getCachedEntryForFile(cache, rfcDirPath, fileName, forceRefresh);
}
