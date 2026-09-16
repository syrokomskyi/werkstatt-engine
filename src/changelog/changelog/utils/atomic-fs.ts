/*
<MODULE_CONTRACT>
<purpose>Supports atomic file writing to ensure safe updates without data corruption.</purpose>
<non-goals>
  <item>Do not perform file reading or content parsing operations.</item>
  <item>Do not manage file transport or configuration settings.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import { writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// START_BLOCK_ATOMIC
/** [CL-ATOMIC][atomicWrite][WRITTEN] path={targetPath} */
export async function atomicWrite(targetPath: string, content: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, targetPath);
}
// END_BLOCK_ATOMIC
