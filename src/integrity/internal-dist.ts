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
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
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
