/*
<MODULE_CONTRACT>
  <purpose>RFC-0954: rescueWorkpieceEdits — preserves uncommitted and unpushed
  workpiece edits before re-materialization overwrites the workpiece directory.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0954: initial rescueWorkpieceEdits implementation.</item>
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";

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

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, MISSION_GIT_COMMIT: "1" },
  }).trim();
}

export async function rescueWorkpieceEdits(
  workpieceDir: string,
  cacheCloneDir: string,
  missionId: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
  workspaceRoot?: string,
  systemId?: string,
): Promise<WorkpieceRescueResult> {
  if (!existsSync(workpieceDir) || !existsSync(path.join(workpieceDir, ".git"))) {
    return noop("workpiece not found or not a git repo");
  }
  if (existsSync(path.join(workpieceDir, ".closed"))) {
    return noop("workpiece is closed");
  }
  if (!existsSync(path.join(cacheCloneDir, ".git"))) {
    return noop("cache clone is not a git repo");
  }

  let committedChanges = false;

  // Step 1: Commit uncommitted changes in workpiece
  try {
    const status = git(workpieceDir, "status --porcelain");
    if (status) {
      git(workpieceDir, "add -A");
      git(
        workpieceDir,
        `commit --no-verify -m "rescue: auto-commit uncommitted workpiece edits before re-materialization ${missionId}"`,
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
    workpieceHead = git(workpieceDir, "rev-parse HEAD");
  } catch {
    return noop("no commits in workpiece");
  }

  // Step 2: Get cache clone HEAD
  let cacheCloneHead: string;
  try {
    cacheCloneHead = git(cacheCloneDir, "rev-parse HEAD");
  } catch {
    return noop("cache clone has no HEAD");
  }

  // Step 3: Check if workpiece HEAD is already an ancestor of cache clone HEAD
  let isAncestor = false;
  try {
    execSync(`git merge-base --is-ancestor ${workpieceHead} ${cacheCloneHead}`, {
      cwd: cacheCloneDir,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });
    isAncestor = true;
  } catch {
    isAncestor = false;
  }

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
    workpieceBranch = git(workpieceDir, "rev-parse --abbrev-ref HEAD");
  } catch {
    // fall back to HEAD
  }

  try {
    execSync(`git fetch ${JSON.stringify(workpieceDir)} ${JSON.stringify(workpieceBranch)}`, {
      cwd: cacheCloneDir,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 30_000,
    });

    execSync(
      `git merge --no-ff FETCH_HEAD -m "rescue: preserve workpiece edits before re-materialization ${missionId}"`,
      {
        cwd: cacheCloneDir,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8",
        timeout: 30_000,
      },
    );

    // Push merged commits to bare repo so they survive syncCacheClone's
    // git reset --hard origin/main on the next materialize.
    let pushedToBareRepo = false;
    let bordbuchEvidence = false;
    try {
      const branch = git(cacheCloneDir, "rev-parse --abbrev-ref HEAD");
      execSync(`git push origin ${JSON.stringify(branch)}`, {
        cwd: cacheCloneDir,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8",
        timeout: 30_000,
      });
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
            "operator-note" as any,
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
    try {
      execSync("git merge --abort", { cwd: cacheCloneDir, stdio: "pipe" });
    } catch {
      // merge --abort also failed — continue
    }

    // Backup old workpiece so edits can be recovered manually
    const backupDir = `${workpieceDir}.rescue-${process.pid}-${Date.now()}`;
    try {
      renameSync(workpieceDir, backupDir);
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
