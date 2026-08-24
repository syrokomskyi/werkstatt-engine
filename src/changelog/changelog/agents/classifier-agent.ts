/*
<MODULE_CONTRACT>
<purpose>Classifies git commits into structured changelog entries using deterministic and LLM-based approaches.</purpose>
<non-goals>
  <item>Do not handle raw content parsing; focus on classification only.</item>
  <item>Do not orchestrate transport or configuration for LLM providers.</item>
  <item>Do not implement commit storage or retrieval functionalities.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Added Compass scaffolding to improve code navigation and maintainability.</item>
</CHANGE_SUMMARY>
*/

import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ClassifiedCommitSchema, type RawCommit, type ClassifiedCommit } from "../types.ts";
import { sanitizeCommit } from "../utils/sanitize.ts";
import { buildCacheKey, cacheGet, cacheSet, hashPromptFile } from "../core/ai-cache.ts";
import { createRateLimiter } from "../core/rate-limiter.ts";
import { retryWithBackoff } from "../utils/retry.ts";
import type { ChangelogCtx } from "../context.ts";

const _CONVENTIONAL_REGEX =
  /^(feat|fix|refactor|docs|perf|test|build|ci|chore|style)(\(.+\))?(!)?:/;
const SKIP_PATTERNS = [/^chore(\(.+\))?: (bump|update) (version|deps|lock)/i, /^(build|ci): /i];

// START_BLOCK_DETERMINISTIC
export function deterministicClassify(commit: RawCommit): ClassifiedCommit {
  const msg = commit.message;
  if (SKIP_PATTERNS.some((p) => p.test(msg))) {
    return {
      hash: commit.hash,
      type: "skip",
      severity: "none",
      module: "general",
      summary: msg,
      isConventional: commit.isConventional,
      isBreaking: false,
      confidence: 1.0,
    };
  }
  if (commit.isConventional && commit.conventionalType) {
    const type = commit.conventionalType as ClassifiedCommit["type"];
    const isBreaking = msg.includes("!:") || (commit.body?.includes("BREAKING CHANGE:") ?? false);
    return {
      hash: commit.hash,
      type: isBreaking ? "breaking" : type,
      severity: type === "feat" || isBreaking ? "minor" : "patch",
      module: /\((.+?)\)/.exec(msg)?.[1] ?? "general",
      summary: msg.slice(msg.indexOf(":") + 1).trim(),
      isConventional: true,
      isBreaking,
      confidence: 0.95,
    };
  }
  return {
    hash: commit.hash,
    type: "chore",
    severity: "patch",
    module: "general",
    summary: msg.slice(0, 100),
    isConventional: false,
    isBreaking: false,
    confidence: 0.5,
  };
}
// END_BLOCK_DETERMINISTIC

// START_BLOCK_CLASSIFY
function buildClient(ctx: ChangelogCtx) {
  return ctx.llmProvider === "anthropic"
    ? createAnthropic({ apiKey: ctx.llmApiKey })(ctx.llmModel)
    : createOpenAI({ apiKey: ctx.llmApiKey })(ctx.llmModel);
}

/** [CL-CLASS][classifyCommit][STARTED] hash={commit.hash} */
export async function classifyCommit(
  commit: RawCommit,
  ctx: ChangelogCtx,
): Promise<ClassifiedCommit> {
  const sanitized = sanitizeCommit(commit);
  if (sanitized.isConventional) return deterministicClassify(commit);

  const promptFile = join(ctx.promptsDir, "classifier.md");
  const promptHash = await hashPromptFile(promptFile);
  const key = buildCacheKey({
    treeHash: commit.treeHash,
    files: commit.files,
    diffSummary: commit.diffSummary,
    promptHash,
    modelVersion: ctx.llmModel,
  });

  const cached = await cacheGet(key, ctx);
  if (cached) {
    const p = ClassifiedCommitSchema.safeParse(cached);
    if (p.success) return p.data;
  }

  const systemPrompt = await readFile(promptFile, "utf-8").catch(() => DEFAULT_CLASSIFIER_PROMPT);
  const input = {
    message: sanitized.message,
    body: sanitized.body ?? "",
    files: commit.files.slice(0, 20),
    diffSummary: sanitized.diffSummary,
    isConventional: commit.isConventional,
  };

  let final: ClassifiedCommit;
  try {
    final = await retryWithBackoff(async () => {
      const response = await generateObject({
        model: buildClient(ctx),
        schema: ClassifiedCommitSchema,
        system: systemPrompt,
        messages: [{ role: "user", content: JSON.stringify(input) }],
        temperature: ctx.llmTemperature,
        maxOutputTokens: ctx.llmMaxTokens,
      });
      return { ...response.object, hash: commit.hash };
    });
  } catch {
    console.warn(`[CL-CLASS][classifyCommit][LLM_FAILED] hash=${commit.hash}`);
    final = deterministicClassify(commit);
  }

  await cacheSet(key, final, ctx);
  return final;
}
// END_BLOCK_CLASSIFY

// START_BLOCK_BATCH
/** [CL-CLASS][classifyBatch][STARTED] count={commits.length} */
export async function classifyBatch(
  commits: RawCommit[],
  ctx: ChangelogCtx,
): Promise<ClassifiedCommit[]> {
  const limit = createRateLimiter(ctx.maxParallelRequests);
  return Promise.all(commits.map((c) => limit(() => classifyCommit(c, ctx))));
}
// END_BLOCK_BATCH

const DEFAULT_CLASSIFIER_PROMPT =
  "You are a changelog classifier. Classify the git commit. Return JSON matching the schema. Use type 'skip' for noise. Assign confidence 0-1.";
