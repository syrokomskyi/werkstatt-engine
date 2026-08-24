/*
<MODULE_CONTRACT>
<purpose>Supports atomic file writing to ensure safe updates without data corruption.</purpose>
<non-goals>
  <item>Do not perform file reading or content parsing operations.</item>
  <item>Do not manage file transport or configuration settings.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Enhance Compass scaffolding to accurately reflect the atomic file writing functionality.</item>
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
