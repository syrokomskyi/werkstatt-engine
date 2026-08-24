/*
<MODULE_CONTRACT>
<purpose>
RFC-0822: Persist and restore operator-filled .env* files between mission workpiece and cache clone.
Provides persistEnvFilesToCacheClone (mission.close) and restoreEnvFilesFromCacheClone (mission.materialize).
</purpose>
<non-goals>
  <item>Do not git-commit .env files — they are untracked artifacts in the cache clone.</item>
  <item>Do not merge .env with .env.example — .env.example is a committed template, .env is operator-filled.</item>
  <item>Do not copy .env files on mission.abort — aborted missions discard secrets.</item>
  <item>Do not encrypt .env files — the cache clone is a local protected store.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0822: initial env-persist module with persistEnvFilesToCacheClone and restoreEnvFilesFromCacheClone.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export interface EnvPersistResult {
  copied: string[];
  skipped: string[];
}

const EXCLUDE_PATTERNS = [".env.example", /^\.env\..*\.example$/];

function shouldExclude(filename: string): boolean {
  for (const pattern of EXCLUDE_PATTERNS) {
    if (typeof pattern === "string") {
      if (filename === pattern) return true;
    } else {
      if (pattern.test(filename)) return true;
    }
  }
  return false;
}

export async function collectEnvFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const envFiles: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(".env")) continue;
    if (shouldExclude(entry.name)) continue;
    envFiles.push(entry.name);
  }
  return envFiles;
}

export async function persistEnvFilesToCacheClone(
  workpieceDir: string,
  cacheCloneDir: string,
): Promise<EnvPersistResult> {
  const copied: string[] = [];
  const skipped: string[] = [];

  const envFiles = await collectEnvFiles(workpieceDir);
  for (const filename of envFiles) {
    const src = path.join(workpieceDir, filename);
    const dest = path.join(cacheCloneDir, filename);
    try {
      await fs.copyFile(src, dest);
      copied.push(filename);
    } catch {
      skipped.push(filename);
    }
  }

  return { copied, skipped };
}

export async function restoreEnvFilesFromCacheClone(
  cacheCloneDir: string,
  workpieceDir: string,
): Promise<EnvPersistResult> {
  const copied: string[] = [];
  const skipped: string[] = [];

  const envFiles = await collectEnvFiles(cacheCloneDir);
  for (const filename of envFiles) {
    const src = path.join(cacheCloneDir, filename);
    const dest = path.join(workpieceDir, filename);
    try {
      let content = await fs.readFile(src, "utf8");
      content = content.replace(
        /^PUBLIC_IMAGE_PROVIDER=.*$/m,
        "PUBLIC_IMAGE_PROVIDER=build-portable",
      );
      await fs.writeFile(dest, content, "utf8");
      copied.push(filename);
    } catch {
      skipped.push(filename);
    }
  }

  return { copied, skipped };
}
