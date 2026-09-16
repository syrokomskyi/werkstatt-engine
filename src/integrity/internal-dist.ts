/***************************************************************
 * <MODULE_CONTRACT>
 * <purpose>Facilitates the discovery of distribution files within a specified directory structure.</purpose>
 *  *  * <non-goals>
 * <item>Do not perform file content parsing or validation.</item>
 * <item>Do not manage build artifact storage or configuration.</item>
 * <item>Do not handle non-file system related errors.</item>
 * </non-goals>
 * </MODULE_CONTRACT>
 *  * <CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
 ***************************************************************/

/**
 * Discover distribution files for build artifact recording.
 * Recursively walks the dist directory to collect all output files.
 */

import path from "node:path";
import { collectFiles } from "@warpgogol/werkstatt-shared/share/fs";

export async function discoverDistFiles(cwd: string, distDir = "dist"): Promise<string[]> {
  const root = path.join(cwd, distDir);
  const files = await collectFiles(root, { ignore: () => false });
  return files
    .map((abs) => path.relative(cwd, abs).replace(/\\/g, "/"))
    .sort((a, b) => a.localeCompare(b));
}
