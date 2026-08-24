/*
<MODULE_CONTRACT>
<purpose>RFC-0580: commitWerkstattSideEffects — auto-commit werkstatt-level side-effect files from mission lifecycle commands to the monorepo working tree.</purpose>
<non-goals>
  <item>Does not push — werkstatt monorepo push is a separate operator-controlled operation.</item>
  <item>Does not commit bordbuch — bordbuch commits go to the cache clone via commitAndPushBordbuch.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0580: initial commitWerkstattSideEffects helper.</item>
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";
import { gitExec } from "./git-exec.ts";

export interface CommitWerkstattResult {
  committed: boolean;
  commitSha: string | null;
}

export async function commitWerkstattSideEffects(
  workspaceRoot: string,
  files: string[],
  message: string,
): Promise<CommitWerkstattResult> {
  for (const file of files) {
    gitExec(workspaceRoot, `add -- ${JSON.stringify(file)}`, { allowNonZero: true });
  }

  let hasStagedChanges: boolean;
  try {
    execSync("git diff --cached --quiet", {
      cwd: workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
    hasStagedChanges = false;
  } catch {
    hasStagedChanges = true;
  }

  if (!hasStagedChanges) {
    return { committed: false, commitSha: null };
  }

  gitExec(workspaceRoot, `commit -m ${JSON.stringify(message)}`, {
    env: { ...process.env, ECOSYSTEM_COMMIT: "1" },
  });
  const commitSha = gitExec(workspaceRoot, "rev-parse HEAD");

  return { committed: true, commitSha };
}
