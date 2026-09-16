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

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
