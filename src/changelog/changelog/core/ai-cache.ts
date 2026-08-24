/*
<MODULE_CONTRACT>
<purpose>Facilitates caching mechanisms for changelog-related data, enhancing performance through efficient data retrieval and storage.</purpose>
<non-goals>
  <item>Do not manage cache eviction policies or expiration.</item>
  <item>Do not parse raw content here; focus solely on caching logic.</item>
  <item>Do not handle transport or configuration orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/

import crypto from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ChangelogCtx } from "../context.ts";

// START_BLOCK_KEY
/** [CL-CACHE][buildCacheKey][KEY_COMPUTED] */
export function buildCacheKey(params: {
  treeHash: string;
  files: string[];
  diffSummary: string;
  promptHash: string;
  modelVersion: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        params.treeHash,
        [...params.files].sort().join("|"),
        params.diffSummary,
        params.promptHash,
        params.modelVersion,
      ].join("::"),
    )
    .digest("hex");
}
// END_BLOCK_KEY

// START_BLOCK_FILE_CACHE
export async function cacheGet(key: string, ctx: ChangelogCtx): Promise<unknown | null> {
  try {
    const data = await readFile(join(ctx.cacheDir, `${key}.json`), "utf-8");
    console.log(`[CL-CACHE][get][HIT] key=${key.slice(0, 12)}...`);
    return JSON.parse(data) as unknown;
  } catch {
    console.log(`[CL-CACHE][get][MISS] key=${key.slice(0, 12)}...`);
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ctx: ChangelogCtx): Promise<void> {
  try {
    await mkdir(ctx.cacheDir, { recursive: true });
    const tmp = join(ctx.cacheDir, `${key}.tmp`);
    const target = join(ctx.cacheDir, `${key}.json`);
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
    await rename(tmp, target);
  } catch {
    /* silent — cache is best-effort */
  }
}
// END_BLOCK_FILE_CACHE

// START_BLOCK_HASH
export async function hashPromptFile(promptPath: string): Promise<string> {
  try {
    return crypto
      .createHash("sha256")
      .update(await readFile(promptPath, "utf-8"))
      .digest("hex");
  } catch {
    return "no-prompt";
  }
}
// END_BLOCK_HASH
