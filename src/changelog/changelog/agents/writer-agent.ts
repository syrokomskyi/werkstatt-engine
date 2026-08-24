/*
<MODULE_CONTRACT>
<purpose>Facilitates the generation of changelog entries based on grouped release data.</purpose>
<non-goals>
  <item>Do not parse raw changelog content or handle file I/O beyond caching.</item>
  <item>Do not manage the orchestration of language model configurations.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import crypto from "node:crypto";
import type { GroupedRelease } from "../types.ts";
import { sanitizeForPrompt } from "../utils/sanitize.ts";
import { type CommitLinks, formatLinksMarkdown } from "../utils/link-extractor.ts";
import { buildCacheKey, cacheGet, cacheSet, hashPromptFile } from "../core/ai-cache.ts";
import { createRateLimiter } from "../core/rate-limiter.ts";
import { retryWithBackoff } from "../utils/retry.ts";
import type { ChangelogCtx } from "../context.ts";

// START_BLOCK_TEMPLATE
export function templateSection(
  group: GroupedRelease["groups"][number],
  commitLinks?: Map<string, CommitLinks>,
): string {
  const heading = TYPE_HEADING[group.type] ?? "### Changed";
  const lines = group.items.map((item) => {
    const links = commitLinks ? mergeItemLinks(item.hashes, commitLinks) : null;
    const linkSuffix = links ? formatLinksMarkdown(links) : ` (${item.hashes.join(", ")})`;
    return `- **${group.module}**: ${item.summary}${linkSuffix}`;
  });
  return `${heading}\n${lines.join("\n")}`;
}

/** Merges CommitLinks from all hashes of one item, deduplicating by number. */
function mergeItemLinks(hashes: string[], map: Map<string, CommitLinks>): CommitLinks | null {
  const issues = new Map<string, CommitLinks["issues"][number]>();
  const prs = new Map<string, CommitLinks["prs"][number]>();
  for (const hash of hashes) {
    const l = map.get(hash);
    if (!l) continue;
    for (const i of l.issues) issues.set(i.number, i);
    for (const p of l.prs) prs.set(p.number, p);
  }
  if (issues.size === 0 && prs.size === 0) return null;
  return { issues: [...issues.values()], prs: [...prs.values()] };
}
// END_BLOCK_TEMPLATE

// START_BLOCK_WRITE
/** [CL-WRITE][writeChangelog][STARTED] date={release.date} */
export async function writeChangelog(
  release: GroupedRelease,
  version: string,
  ctx: ChangelogCtx,
  commitLinks?: Map<string, CommitLinks>,
): Promise<string> {
  if (release.groups.length === 0)
    return `## ${version} (${release.date})\n\nNo changes in this release window.\n`;

  const promptFile = join(ctx.promptsDir, "writer.md");
  const promptHash = await hashPromptFile(promptFile);
  const releaseHash = crypto.createHash("sha256").update(JSON.stringify(release)).digest("hex");
  const key = buildCacheKey({
    treeHash: releaseHash,
    files: release.groups.map((g) => g.module),
    diffSummary: "",
    promptHash,
    modelVersion: ctx.llmModel,
  });

  const cached = await cacheGet(key, ctx);
  if (typeof cached === "string") return cached;

  const systemPrompt = await readFile(promptFile, "utf-8").catch(() => DEFAULT_WRITER_PROMPT);
  const client =
    ctx.llmProvider === "anthropic"
      ? createAnthropic({ apiKey: ctx.llmApiKey })(ctx.llmModel)
      : createOpenAI({ apiKey: ctx.llmApiKey })(ctx.llmModel);
  const limit = createRateLimiter(ctx.maxParallelRequests);

  // Sanitize summaries for the LLM; enrich items with resolved links so the
  // model can reference them in prose (e.g. "fixes issue #321").
  const sanitizedRelease = {
    ...release,
    groups: release.groups.map((g) => ({
      ...g,
      items: g.items.map((item) => {
        const links = commitLinks ? mergeItemLinks(item.hashes, commitLinks) : null;
        return {
          ...item,
          summary: sanitizeForPrompt(item.summary),
          ...(links ? { issues: links.issues, prs: links.prs } : {}),
        };
      }),
    })),
  };

  const sections = await Promise.all(
    sanitizedRelease.groups.map((group) =>
      limit(async () => {
        try {
          const text = await retryWithBackoff(async () => {
            const { text } = await generateText({
              model: client,
              system: systemPrompt,
              messages: [{ role: "user", content: JSON.stringify(group) }],
              temperature: ctx.llmTemperature,
              maxOutputTokens: ctx.llmMaxTokens,
            });
            return text.trim();
          });
          return text;
        } catch {
          console.warn(`[CL-WRITE][writeSection][LLM_FAILED] module=${group.module}`);
          return templateSection(group, commitLinks);
        }
      }),
    ),
  );

  const content = [`## ${version} (${release.date})`, "", ...sections, ""].join("\n");
  await cacheSet(key, content, ctx);
  return content;
}
// END_BLOCK_WRITE

const TYPE_HEADING: Record<string, string> = {
  feat: "### Added",
  fix: "### Fixed",
  breaking: "### Breaking",
  refactor: "### Changed",
  perf: "### Improved",
  docs: "### Documentation",
  chore: "### Maintenance",
  ci: "### CI",
  build: "### Build",
  test: "### Tests",
};

const DEFAULT_WRITER_PROMPT =
  "You are a changelog writer. Write a concise Markdown section for the given group. Past tense. No marketing. Explain what changed and its impact. Use a ### heading and bullet points.";
