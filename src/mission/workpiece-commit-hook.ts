/*
<MODULE_CONTRACT>
  <purpose>RFC-0821: installWorkpieceCommitHook — writes a pre-commit guard to the
  workpiece git repo that rejects raw `git commit` without MISSION_GIT_COMMIT=1 env var.
  This enforces the commit discipline rule: all workpiece commits must go through
  mission.git.commit, not raw git commit.
  RFC-0878: also checks for .closed sentinel file — refuses all commits (including
  MISSION_GIT_COMMIT=1 bypass) when the mission is closed.</purpose>
  <non-goals>
    <item>Does not install hooks in cache clones — the workspace-level hooks/pre-commit
    handles platform-scope blocking via ECOSYSTEM_COMMIT env var.</item>
    <item>Does not block --no-verify commits — internal platform helpers
    (commitWorkpieceIfDirty, commitCacheCloneIfDirty) use --no-verify intentionally.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0821: initial installWorkpieceCommitHook implementation.</item>
  <item>RFC-0878: add .closed sentinel check — block commits in closed workpieces even with MISSION_GIT_COMMIT=1.</item>
  <item>RFC-1199: sentinel-aware refusal message for MATERIALIZATION-IN-PROGRESS; hook now installs during setup-staging (rides atomic-move) instead of post-commit.</item>
</CHANGE_SUMMARY> 
*/

import path from "node:path";
import { writeFileIfChanged } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export interface WorkpieceHookResult {
  installed: boolean;
  hookPath: string;
}

const HOOK_SCRIPT = `#!/bin/sh
# Warpgogol workpiece commit guard (RFC-0821 + RFC-0878 + RFC-1199)
# Rejects raw git commit — use mission.git.commit instead:
#   pnpm exec werkstatt run mission.git.commit --mission=<id> --message="<msg>"
if [ -z "\${MISSION_GIT_COMMIT:-}" ]; then
  # RFC-1199: name the materialization window explicitly when its sentinel is
  # present — during that window there is no baseline commit to build on.
  if [ -f "$(pwd)/.git/MATERIALIZATION-IN-PROGRESS" ]; then
    echo "ERROR: Commit blocked — workpiece materialization is still in progress (RFC-1199)." >&2
    echo "" >&2
    echo "The pipeline has not created the baseline commit yet." >&2
    echo "Wait for mission.materialize to finish; if it failed, run:" >&2
    echo "  pnpm exec werkstatt run mission.resume --mission <missionId>" >&2
    exit 1
  fi
  echo "ERROR: Direct git commit blocked in workpiece (RFC-0821)." >&2
  echo "" >&2
  echo "Use mission.git.commit instead:" >&2
  echo "  pnpm exec werkstatt run mission.git.commit --mission=<missionId> --message=\"<message>\"" >&2
  echo "" >&2
  echo "Raw git commit bypasses pre-commit validators, bordbuch recording, and signed-commit support." >&2
  exit 1
fi
# RFC-0878: Block all commits (including MISSION_GIT_COMMIT bypass) in closed workpieces.
# The .closed sentinel is written by mission.close as a final step.
if [ -f "$(pwd)/.closed" ]; then
  echo "ERROR: Commit blocked — workpiece is closed (RFC-0878)." >&2
  echo "" >&2
  echo "The mission for this workpiece has been closed. No commits are allowed." >&2
  echo "If you need to make changes, open a new mission or reopen this one." >&2
  exit 1
fi
`;

export async function installWorkpieceCommitHook(
  workpieceDir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<WorkpieceHookResult> {
  const hooksDir = path.join(workpieceDir, ".git", "hooks");
  const hookPath = path.join(hooksDir, "pre-commit");

  if (!(await io.exists(path.join(workpieceDir, ".git")))) {
    return { installed: false, hookPath };
  }

  if (!(await io.exists(hooksDir))) {
    await io.mkdir(hooksDir);
  }

  await writeFileIfChanged(hookPath, HOOK_SCRIPT);
  const chmodResult = await io.exec("chmod", ["755", hookPath]);
  if (chmodResult.exitCode !== 0) {
    throw new Error(
      `chmod ${hookPath} exited ${chmodResult.exitCode}: ${chmodResult.stderr.slice(0, 200)}`,
    );
  }

  return { installed: true, hookPath };
}
