/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Utility functions for reading, writing, and stringifying JSON data with a focus on integrity and determinism.</purpose> 
 
 
<non-goals> 
<item>Do not handle raw content parsing beyond JSON.</item> 
<item>Do not manage file transport or configuration orchestration.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY> 
******************************************************************************/

/**
 * JSON utilities with stable stringification for integrity files.
 * Provides sorted key output for deterministic file hashes.
 */

import path from "node:path";
import { ensureDir, readText, writeText } from "./fs.ts";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, sortValue(nested)]);
    return Object.fromEntries(entries);
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readText(filePath)) as T;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeText(filePath, stableStringify(value));
}
