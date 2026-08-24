/***************************************************************
 * <MODULE_CONTRACT>
 * <purpose>
 * Facilitates the management and updating of changelog files
 * within the application, ensuring versioning and content
 * integrity.
 * </purpose>
 *  *  * <non-goals>
 * <item>Do not parse raw changelog content or enforce formatting rules.</item>
 * <item>Do not manage changelog file transport or configuration.</item>
 * </non-goals>
 * </MODULE_CONTRACT>
 *  * <CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
 ***************************************************************/

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite } from "../utils/atomic-fs.ts";
import type { ChangelogCtx } from "../context.ts";

const MARKER_START = "<!-- DYNFIELD:RELEASES -->";
const MARKER_END = "<!-- /RELEASES -->";

// START_BLOCK_VERSIONED
/**
 * Writes versioned changelog file to app/changelogs/changelog-YYYY-MM-DD-vX.Y.Z.md.
 * [CL-INDEX][writeVersionedFile][ATOMIC_WRITE] path={filePath}
 */
export async function writeVersionedFile(
  date: string,
  version: string,
  content: string,
  ctx: ChangelogCtx,
): Promise<string> {
  const filename = `changelog-${date}-v${version}.md`;
  const filePath = join(ctx.detailsDir, filename);
  await atomicWrite(
    filePath,
    `<!-- release-id: ${date} -->\n<!-- version: ${version} -->\n\n${content}`,
  );
  console.log(`[CL-INDEX][writeVersionedFile][ATOMIC_WRITE] path=${filePath}`);
  return filename;
}
// END_BLOCK_VERSIONED

// START_BLOCK_MARKERS
/**
 * Replaces content between DYNFIELD:RELEASES markers. Auto-restores if markers are absent.
 * [CL-INDEX][rebuildIndex][MARKERS_RESTORED] — emitted when markers were absent.
 */
export function replaceBetweenMarkers(content: string, newContent: string): string {
  if (!content.includes(MARKER_START) || !content.includes(MARKER_END)) {
    console.warn(
      "[CL-INDEX][rebuildIndex][MARKERS_RESTORED] Dynamic markers not found. Auto-restoring.",
    );
    return `${content}\n\n${MARKER_START}\n${newContent}\n${MARKER_END}\n`;
  }
  const before = content.slice(0, content.indexOf(MARKER_START) + MARKER_START.length);
  const after = content.slice(content.indexOf(MARKER_END));
  return `${before}\n${newContent}\n${after}`;
}
// END_BLOCK_MARKERS

// START_BLOCK_REBUILD
/** [CL-INDEX][rebuildIndex][STARTED] */
export async function rebuildIndex(
  date: string,
  version: string,
  filename: string,
  ctx: ChangelogCtx,
): Promise<void> {
  let current = "";
  try {
    current = await readFile(ctx.indexFile, "utf-8");
  } catch {
    current = `# Changelog\n\nAll notable changes to **${ctx.appName}**.\n\n${MARKER_START}\n${MARKER_END}\n`;
  }

  const entry = `- **[${version}](./${ctx.detailsDir.split("/").pop()}/${filename})** (${date})`;
  const newContent = replaceBetweenMarkers(current, entry);
  await atomicWrite(ctx.indexFile, newContent);
  console.log(`[CL-INDEX][rebuildIndex][DONE] indexFile=${ctx.indexFile}`);
}
// END_BLOCK_REBUILD
