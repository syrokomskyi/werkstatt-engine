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
  <item>Added Compass scaffolding to clarify module purpose and responsibilities.</item>
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
