/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Maintains packages/os/site-kernel-integrity/src/fs.ts as an authored site-kernel-integrity authored module so agents can evolve it without rediscovering local boundaries.</purpose>
 
 
<non-goals> 
  <item>Do not handle file system event monitoring.</item> 
  <item>Do not parse raw content here.</item> 
  <item>Do not manage file permissions or ownership.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY> 
*******************************************************************************/

/**
 * File system utilities for integrity operations.
 * Provides async wrappers for directory creation, file read/write, and path checks.
 */

import { promises as fs } from "node:fs";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, "utf8");
}

export async function readBuffer(filePath: string): Promise<Buffer> {
  return fs.readFile(filePath);
}
