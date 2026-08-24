/*
<MODULE_CONTRACT>
<purpose>RFC-0362: Atomic write helpers — temp-file + rename for files, staging dir + rename for directories.</purpose>
<non-goals>
  <item>Do not implement distributed transaction coordination.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0362: initial atomic write helpers (atomicWriteFile, atomicMoveDir).</item>
  <item>Windows EBUSY: atomicMoveDir uses rename-to-trash instead of fs.rm for replace operations — rename succeeds where deletion fails on Windows.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;

  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }

  await fs.writeFile(tmpPath, content, "utf8");
  try {
    await fs.rename(tmpPath, targetPath);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

const RENAME_RETRYABLE_CODES = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);

async function renameWithRetry(src: string, dest: string, maxRetries = 5): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !RENAME_RETRYABLE_CODES.has(code)) throw err;
      if (attempt < maxRetries) {
        const delay = 50 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export async function atomicMoveDir(
  stagingDir: string,
  targetDir: string,
  options?: { replace?: boolean },
): Promise<void> {
  let trashDir: string | undefined;

  if (existsSync(targetDir)) {
    if (!options?.replace) {
      throw new Error(
        `[werkstatt.atomic] target '${targetDir}' already exists — use --replace to overwrite`,
      );
    }
    // On Windows, fs.rm often fails with EBUSY on directories containing
    // symlinks/junctions (e.g. pnpm node_modules). Renaming usually succeeds
    // where deletion fails. Strategy: rename old target to trash, then rename
    // staging into place, then best-effort delete trash.
    trashDir = `${targetDir}.trash-${process.pid}-${Date.now()}`;
    if (existsSync(trashDir)) {
      await fs.rm(trashDir, { recursive: true, force: true }).catch(() => {});
    }
    await renameWithRetry(targetDir, trashDir);
  }

  const parentDir = path.dirname(targetDir);
  if (!existsSync(parentDir)) {
    await fs.mkdir(parentDir, { recursive: true });
  }

  await renameWithRetry(stagingDir, targetDir);

  // Best-effort cleanup of the old directory
  if (trashDir && existsSync(trashDir)) {
    await fs.rm(trashDir, { recursive: true, force: true }).catch(() => {
      // Ignore — trash will be cleaned up on next run or manually.
    });
  }
}

export function resolveStagingDir(
  workspaceRoot: string,
  targetDir: string,
  operationId: string,
): string {
  const relativeTarget = path.relative(workspaceRoot, targetDir);
  const safeName = relativeTarget.replace(/[^a-zA-Z0-9/_-]/g, "_");
  return path.join(workspaceRoot, `${safeName}.staging-${operationId}`);
}
