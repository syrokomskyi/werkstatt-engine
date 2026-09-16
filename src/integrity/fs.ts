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
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
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
