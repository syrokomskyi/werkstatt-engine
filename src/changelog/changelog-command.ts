/*
<MODULE_CONTRACT>
<purpose>Facilitates changelog management for applications, including generation, rebuilding, and backfilling of changelogs.</purpose>
<non-goals>
  <item>Do not handle raw commit parsing or direct Git interactions outside of changelog context.</item>
  <item>Do not manage application configuration or transport orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Backfilled architectural documentation for changelog management functionalities.</item>
</CHANGE_SUMMARY>
*/

import { readFile, writeFile, mkdir } from "node:fs/promises";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { buildChangelogCtx, readFlag } from "./changelog/context.ts";
import type { ChangelogCtx } from "./changelog/context.ts";
import type { SystemState } from "./changelog/types.ts";
import { isTodayReleaseDay, getPeriodWindow, formatDateISO } from "./changelog/utils/date.ts";
import type { Schedule } from "./changelog/utils/date.ts";
import { collectCommits, getLatestCommitHash, getAppVersion } from "./changelog/utils/git.ts";
import { sanitizeCommit } from "./changelog/utils/sanitize.ts";
import { buildCommitLinksMap } from "./changelog/utils/link-extractor.ts";
import { classifyBatch } from "./changelog/agents/classifier-agent.ts";
import { groupCommits } from "./changelog/agents/grouper-agent.ts";
import { writeChangelog } from "./changelog/agents/writer-agent.ts";
import { calculateNextVersion } from "./changelog/core/version-bumper.ts";
import { writeVersionedFile, rebuildIndex } from "./changelog/core/index-rebuilder.ts";

// START_BLOCK_STATE
async function loadState(ctx: ChangelogCtx): Promise<SystemState> {
  try {
    return JSON.parse(await readFile(ctx.statePath, "utf-8")) as SystemState;
  } catch {
    return { lastProcessedCommitHash: "", lastVersion: "", processedWindows: [] };
  }
}

async function saveState(state: SystemState, ctx: ChangelogCtx): Promise<void> {
  await mkdir(ctx.statePath.replace(/[/\\][^/\\]+$/, ""), { recursive: true });
  await writeFile(ctx.statePath, JSON.stringify(state, null, 2), "utf-8");
}
// END_BLOCK_STATE

// START_BLOCK_GENERATE
/**
 * Full changelog generation pipeline scoped to the target app.
 * [CL-MAIN][runChangelogGenerate][STARTED] app={ctx.appName}
 */
export async function runChangelogGenerate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ version: string; filename: string } | null>> {
  const ctx = buildChangelogCtx(input, context);
  context.logger.info(
    `[CL-MAIN][runChangelogGenerate][STARTED] app=${ctx.appName} dryRun=${ctx.dryRun}`,
  );

  const schedule: Schedule =
    ctx.releaseMode === "weekly"
      ? { mode: "weekly", weekday: ctx.releaseDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 }
      : { mode: "monthly", dayOfMonth: ctx.releaseDay };

  if (!ctx.force && !isTodayReleaseDay(schedule, ctx.timezone)) {
    context.logger.info(
      `[CL-MAIN][runChangelogGenerate][SKIPPED] Not a release day. Use --force to override.`,
    );
    return { data: null, summary: `${ctx.appName}: skipped — not a release day` };
  }

  const { from, to } = getPeriodWindow(schedule, ctx.timezone);
  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  const state = await loadState(ctx);
  if (!ctx.force && state.processedWindows.some((w) => w.from === fromISO && w.to === toISO)) {
    context.logger.info("[CL-MAIN][runChangelogGenerate][SKIPPED] Window already processed.");
    return { data: null, summary: `${ctx.appName}: skipped — window already processed` };
  }

  const rawCommits = await collectCommits(fromISO, toISO, ctx);
  context.logger.info(`[CL-MAIN][runChangelogGenerate][COLLECTED] count=${rawCommits.length}`);

  if (rawCommits.length === 0) {
    return { data: null, summary: `${ctx.appName}: no commits in window` };
  }

  const sanitized = rawCommits.map(sanitizeCommit);
  const classified = await classifyBatch(sanitized, ctx);
  const nonSkip = classified.filter((c) => c.type !== "skip");

  if (nonSkip.length === 0) {
    return { data: null, summary: `${ctx.appName}: all commits are noise` };
  }

  const grouped = await groupCommits(classified, ctx);
  const currentVersion = await getAppVersion(ctx.appDir);
  const bump = calculateNextVersion(currentVersion, classified, ctx.confidenceThreshold);

  context.logger.info(
    `[CL-MAIN][runChangelogGenerate][BUMPED] ${currentVersion} → ${bump.version}`,
  );
  if (bump.requiresReview) {
    context.logger.warn(
      `[CL-MAIN][runChangelogGenerate][REVIEW_REQUIRED] Low-confidence breaking changes detected.`,
    );
  }

  const commitLinks = buildCommitLinksMap(rawCommits, ctx.repoUrl);
  const content = await writeChangelog(grouped, bump.version, ctx, commitLinks);

  if (ctx.dryRun) {
    context.logger.info("--- DRY RUN OUTPUT ---\n" + content);
    return {
      data: null,
      summary: `${ctx.appName}: dry-run complete — version would be ${bump.version}`,
    };
  }

  const date = formatDateISO(new Date());
  const filename = await writeVersionedFile(date, bump.version, content, ctx);
  await rebuildIndex(date, bump.version, filename, ctx);
  await bumpAppVersion(bump.version, ctx);

  const headHash = await getLatestCommitHash(ctx.workspaceRoot);
  state.lastProcessedCommitHash = headHash;
  state.lastVersion = bump.version;
  state.processedWindows.push({
    from: fromISO,
    to: toISO,
    version: bump.version,
    checksum: headHash,
  });
  await saveState(state, ctx);

  context.logger.info(
    `[CL-MAIN][runChangelogGenerate][DONE] version=${bump.version} file=${filename}`,
  );
  return {
    data: { version: bump.version, filename },
    summary: `${ctx.appName}: changelog generated → ${bump.version} (${filename})`,
  };
}
// END_BLOCK_GENERATE

// START_BLOCK_REBUILD
export async function runChangelogRebuildIndex(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ indexFile: string }>> {
  const ctx = buildChangelogCtx(input, context);
  const state = await loadState(ctx);
  const date = formatDateISO(new Date());
  const version = state.lastVersion || (await getAppVersion(ctx.appDir));
  const filename = `changelog-${date}-v${version}.md`;
  await rebuildIndex(date, version, filename, ctx);
  return {
    data: { indexFile: ctx.indexFile },
    summary: `${ctx.appName}: index rebuilt at ${ctx.indexFile}`,
  };
}
// END_BLOCK_REBUILD

// START_BLOCK_BACKFILL
export async function runChangelogBackfill(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ version: string } | null>> {
  const ctx = buildChangelogCtx(input, context);
  const start = readFlag(input, "start");
  const end = readFlag(input, "end");
  if (!start || !end) {
    return {
      data: null,
      exitCode: 1,
      summary: "backfill requires --start and --end flags (YYYY-MM-DD)",
    };
  }

  const rawCommits = await collectCommits(
    new Date(start).toISOString(),
    new Date(end).toISOString(),
    ctx,
  );
  const classified = await classifyBatch(rawCommits.map(sanitizeCommit), ctx);
  const grouped = await groupCommits(classified, ctx);
  const currentVersion = await getAppVersion(ctx.appDir);
  const bump = calculateNextVersion(currentVersion, classified, ctx.confidenceThreshold);
  const commitLinks = buildCommitLinksMap(rawCommits, ctx.repoUrl);
  const content = await writeChangelog(grouped, bump.version, ctx, commitLinks);

  if (ctx.dryRun) {
    context.logger.info(content);
    return {
      data: null,
      summary: `${ctx.appName}: backfill dry-run — version would be ${bump.version}`,
    };
  }

  const filename = await writeVersionedFile(start, bump.version, content, ctx);
  await rebuildIndex(start, bump.version, filename, ctx);
  return {
    data: { version: bump.version },
    summary: `${ctx.appName}: backfill complete → ${bump.version}`,
  };
}
// END_BLOCK_BACKFILL

// START_BLOCK_HELPERS
async function bumpAppVersion(newVersion: string, ctx: ChangelogCtx): Promise<void> {
  const pkgPath = `${ctx.appDir}/package.json`;
  try {
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    pkg["version"] = newVersion;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  } catch (err) {
    console.warn("[CL-MAIN][bumpAppVersion][FAILED]", err);
  }
}
// END_BLOCK_HELPERS
