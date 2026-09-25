/*
<MODULE_CONTRACT>
  <purpose>RFC-0954: rescueWorkpieceEdits — preserves uncommitted and unpushed
  workpiece edits before re-materialization overwrites the workpiece directory.</purpose>
<non-goals>
  <item>Do not mutate the workpiece — rescue only recovers state, it never rewrites content.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0954: initial rescueWorkpieceEdits implementation.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import type { BordbuchEntryKind } from "@warpgogol/werkstatt-engine/schemas";

export interface WorkpieceRescueResult {
  rescued: boolean;
  committedChanges: boolean;
  commitSha: string | null;
  mergedToCacheClone: boolean;
  pushedToBareRepo: boolean;
  bordbuchEvidence: boolean;
  backupDir: string | null;
  reason: string;
}

function noop(reason: string): WorkpieceRescueResult {
  return {
    rescued: false,
    committedChanges: false,
    commitSha: null,
    mergedToCacheClone: false,
    pushedToBareRepo: false,
    bordbuchEvidence: false,
    backupDir: null,
    reason,
  };
}

async function git(cwd: string, args: string, io: WorkspaceIO): Promise<string> {
  // Shell-string args preserved verbatim via sh -c — interpolated JSON.stringify
  // quoting keeps identical semantics without re-tokenizing.
  const result = await io.exec("sh", ["-c", `git ${args}`], {
    cwd,
    env: { MISSION_GIT_COMMIT: "1" },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function rescueWorkpieceEdits(
  workpieceDir: string,
  cacheCloneDir: string,
  missionId: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
  workspaceRoot?: string,
  systemId?: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<WorkpieceRescueResult> {
  if (!(await io.exists(workpieceDir)) || !(await io.exists(path.join(workpieceDir, ".git")))) {
    return noop("workpiece not found or not a git repo");
  }
  if (await io.exists(path.join(workpieceDir, ".closed"))) {
    return noop("workpiece is closed");
  }
  if (!(await io.exists(path.join(cacheCloneDir, ".git")))) {
    return noop("cache clone is not a git repo");
  }

  let committedChanges = false;

  // Step 1: Commit uncommitted changes in workpiece
  try {
    const status = await git(workpieceDir, "status --porcelain", io);
    if (status) {
      await git(workpieceDir, "add -A", io);
      await git(
        workpieceDir,
        `commit --no-verify -m "rescue: auto-commit uncommitted workpiece edits before re-materialization ${missionId}"`,
        io,
      );
      committedChanges = true;
      logger.info(`  [rescue] Committed uncommitted changes in workpiece`);
    }
  } catch (err) {
    logger.warn(
      `  [rescue] Failed to commit uncommitted changes: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Get workpiece HEAD after potential commit
  let workpieceHead: string;
  try {
    workpieceHead = await git(workpieceDir, "rev-parse HEAD", io);
  } catch {
    return noop("no commits in workpiece");
  }

  // Step 2: Get cache clone HEAD
  let cacheCloneHead: string;
  try {
    cacheCloneHead = await git(cacheCloneDir, "rev-parse HEAD", io);
  } catch {
    return noop("cache clone has no HEAD");
  }

  // Step 3: Check if workpiece HEAD is already an ancestor of cache clone HEAD
  let isAncestor = false;
  const ancestorResult = await io.exec(
    "git",
    ["merge-base", "--is-ancestor", workpieceHead, cacheCloneHead],
    { cwd: cacheCloneDir },
  );
  isAncestor = ancestorResult.exitCode === 0;

  if (isAncestor) {
    return {
      rescued: committedChanges,
      committedChanges,
      commitSha: workpieceHead,
      mergedToCacheClone: true,
      pushedToBareRepo: true,
      bordbuchEvidence: false,
      backupDir: null,
      reason: committedChanges
        ? "workpiece HEAD already in cache clone"
        : "no new commits in workpiece",
    };
  }

  // Step 4: Fetch workpiece branch into cache clone and merge --no-ff
  let workpieceBranch = "HEAD";
  try {
    workpieceBranch = await git(workpieceDir, "rev-parse --abbrev-ref HEAD", io);
  } catch {
    // fall back to HEAD
  }

  try {
    await git(
      cacheCloneDir,
      `fetch ${JSON.stringify(workpieceDir)} ${JSON.stringify(workpieceBranch)}`,
      io,
    );

    await git(
      cacheCloneDir,
      `merge --no-ff FETCH_HEAD -m "rescue: preserve workpiece edits before re-materialization ${missionId}"`,
      io,
    );

    // Push merged commits to bare repo so they survive syncCacheClone's
    // git reset --hard origin/main on the next materialize.
    let pushedToBareRepo = false;
    let bordbuchEvidence = false;
    try {
      const branch = await git(cacheCloneDir, "rev-parse --abbrev-ref HEAD", io);
      await git(cacheCloneDir, `push origin ${JSON.stringify(branch)}`, io);
      pushedToBareRepo = true;
      logger.info(`  [rescue] Pushed rescued commits to bare repo`);
    } catch (pushErr) {
      logger.warn(
        `  [rescue] Failed to push to bare repo — rescued commits in cache clone only: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`,
      );
      // RFC-0954: Bordbuch evidence fallback — if push fails, record the rescue
      // in bordbuch so the operator knows rescued commits exist only in the
      // cache clone and may be lost on next syncCacheClone.
      if (workspaceRoot && systemId) {
        try {
          await appendAndCommitBordbuch(
            workspaceRoot,
            systemId,
            "operator-note" as BordbuchEntryKind,
            `Rescue push failed for ${missionId} — commits ${workpieceHead.slice(0, 8)} in cache clone only`,
            "mission:rescue",
            {
              missionId,
              writerRole: "operator",
              metadata: {
                rescueCommitSha: workpieceHead,
                pushError: pushErr instanceof Error ? pushErr.message : String(pushErr),
                warning: "Rescued commits may be lost on next syncCacheClone",
              },
            },
            `Bordbuch: rescue-push-failed ${systemId}`,
          );
          bordbuchEvidence = true;
          logger.info(`  [rescue] Recorded push failure in bordbuch as evidence`);
        } catch (bordbuchErr) {
          logger.warn(
            `  [rescue] Failed to record bordbuch evidence: ${bordbuchErr instanceof Error ? bordbuchErr.message : String(bordbuchErr)}`,
          );
        }
      }
    }

    logger.info(
      `  [rescue] Merged workpiece edits into cache clone (${workpieceHead.slice(0, 8)})`,
    );

    return {
      rescued: true,
      committedChanges,
      commitSha: workpieceHead,
      mergedToCacheClone: true,
      pushedToBareRepo,
      bordbuchEvidence,
      backupDir: null,
      reason: pushedToBareRepo
        ? "rescued successfully"
        : "rescued to cache clone only (push failed, bordbuch evidence recorded)",
    };
  } catch (err) {
    // Merge failed — abort merge in cache clone
    await io.exec("git", ["merge", "--abort"], { cwd: cacheCloneDir }).catch(() => {});

    // Backup old workpiece so edits can be recovered manually
    const backupDir = `${workpieceDir}.rescue-${process.pid}-${Date.now()}`;
    try {
      await io.rename(workpieceDir, backupDir);
      logger.warn(
        `  [rescue] Merge failed — backed up old workpiece to ${path.basename(backupDir)}`,
      );
      logger.warn(`  [rescue] Merge error: ${err instanceof Error ? err.message : String(err)}`);
    } catch {
      logger.warn(`  [rescue] Failed to backup old workpiece`);
      return noop("merge failed, backup also failed");
    }

    return {
      rescued: false,
      committedChanges,
      commitSha: workpieceHead,
      mergedToCacheClone: false,
      pushedToBareRepo: false,
      bordbuchEvidence: false,
      backupDir,
      reason: "merge failed — old workpiece backed up for manual recovery",
    };
  }
}
