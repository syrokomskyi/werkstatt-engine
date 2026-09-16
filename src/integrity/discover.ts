/*
<MODULE_CONTRACT>
<purpose>Supports the identification and organization of files and directories according to integrity policies.</purpose>
<non-goals>
  <item>Do not parse or manipulate the content of files.</item>
  <item>Do not manage Git repository configurations or states.</item>
  <item>Do not provide user interface or command-line functionalities.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

/**
 * Discover managed files based on integrity policy.
 * Filters Git-tracked files against include/exclude glob patterns.
 */

import path from "node:path";
import { getTrackedFiles } from "./git.ts";
import { loadPolicy, isManagedPath } from "./policy.ts";

export async function discoverManagedFiles(cwd: string): Promise<string[]> {
  const policy = await loadPolicy(cwd);
  const tracked = await getTrackedFiles(cwd);
  return tracked
    .map((filePath) => filePath.replace(/\\/g, "/"))
    .filter((filePath) => isManagedPath(filePath, policy))
    .sort((a, b) => a.localeCompare(b));
}

export async function discoverManagedDirectories(cwd: string): Promise<string[]> {
  const files = await discoverManagedFiles(cwd);
  return Array.from(new Set(files.map((filePath) => path.posix.dirname(filePath)))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export async function groupFilesByDirectory(filePaths: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const filePath of filePaths) {
    const dir = path.posix.dirname(filePath);
    const list = map.get(dir) ?? [];
    list.push(filePath);
    map.set(dir, list);
  }
  for (const [dir, list] of map) {
    map.set(
      dir,
      list.sort((a, b) => a.localeCompare(b)),
    );
  }
  return map;
}
