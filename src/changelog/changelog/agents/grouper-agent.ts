/* 
<MODULE_CONTRACT> 
<purpose>Orchestrates the grouping of commits into structured releases based on module and type.</purpose> 
 
 
<non-goals> 
  <item>Do not handle raw commit parsing or validation.</item> 
  <item>Do not manage AI model lifecycle or configuration settings.</item> 
  <item>Do not perform logging beyond necessary warnings for fallback.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>Added Compass scaffolding to improve code clarity and navigation.</item>
</CHANGE_SUMMARY> 
*/

import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import crypto from "node:crypto";
import { GroupedReleaseSchema, type ClassifiedCommit, type GroupedRelease } from "../types.ts";
import { buildCacheKey, cacheGet, cacheSet, hashPromptFile } from "../core/ai-cache.ts";
import { createRateLimiter } from "../core/rate-limiter.ts";
import { retryWithBackoff } from "../utils/retry.ts";
import { formatDateISO } from "../utils/date.ts";
import type { ChangelogCtx } from "../context.ts";

const GroupOutputSchema = z.object({
  groups: z.array(
    z.object({
      module: z.string(),
      type: z.string(),
      items: z.array(z.object({ summary: z.string(), hashes: z.array(z.string()) })),
    }),
  ),
});

// START_BLOCK_DETERMINISTIC
export function deterministicGroup(commits: ClassifiedCommit[], date: string): GroupedRelease {
  const byModule = new Map<string, ClassifiedCommit[]>();
  for (const c of commits) {
    const arr = byModule.get(c.module) ?? [];
    arr.push(c);
    byModule.set(c.module, arr);
  }
  return {
    date,
    groups: [...byModule.entries()].map(([mod, items]) => ({
      module: mod,
      type: items[0]?.type ?? "chore",
      items: items.map((c) => ({ summary: c.summary, hashes: [c.hash] })),
    })),
  };
}
// END_BLOCK_DETERMINISTIC

// START_BLOCK_GROUP
/** [CL-GROUP][groupCommits][STARTED] count={commits.length} */
export async function groupCommits(
  commits: ClassifiedCommit[],
  ctx: ChangelogCtx,
): Promise<GroupedRelease> {
  const filtered = commits.filter((c) => c.type !== "skip");
  const date = formatDateISO(new Date());
  if (filtered.length === 0) return { date, groups: [] };

  const rawHash = crypto
    .createHash("sha256")
    .update(filtered.map((c) => c.hash).join(","))
    .digest("hex");
  const promptFile = join(ctx.promptsDir, "grouper.md");
  const promptHash = await hashPromptFile(promptFile);
  const key = buildCacheKey({
    treeHash: rawHash,
    files: filtered.map((c) => c.module),
    diffSummary: "",
    promptHash,
    modelVersion: ctx.llmModel,
  });

  const cached = await cacheGet(key, ctx);
  if (cached) {
    const p = GroupedReleaseSchema.safeParse(cached);
    if (p.success) return p.data;
  }

  const systemPrompt = await readFile(promptFile, "utf-8").catch(() => DEFAULT_GROUPER_PROMPT);
  const client =
    ctx.llmProvider === "anthropic"
      ? createAnthropic({ apiKey: ctx.llmApiKey })(ctx.llmModel)
      : createOpenAI({ apiKey: ctx.llmApiKey })(ctx.llmModel);

  const limit = createRateLimiter(1);
  return limit(async () => {
    let release: GroupedRelease;
    try {
      release = await retryWithBackoff(async () => {
        const response = await generateObject({
          model: client,
          schema: GroupOutputSchema,
          system: systemPrompt,
          messages: [{ role: "user", content: JSON.stringify(filtered) }],
          temperature: ctx.llmTemperature,
          maxOutputTokens: ctx.llmMaxTokens,
        });
        return { date, ...response.object } as GroupedRelease;
      });
    } catch {
      console.warn("[CL-GROUP][groupCommits][LLM_FAILED] using deterministic fallback");
      return deterministicGroup(filtered, date);
    }
    await cacheSet(key, release, ctx);
    return release;
  });
}
// END_BLOCK_GROUP

const DEFAULT_GROUPER_PROMPT =
  "You are a changelog grouper. Cluster commits into 5-7 business groups by functional area. Output JSON matching the schema.";
