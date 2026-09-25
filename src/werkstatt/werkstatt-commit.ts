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
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
</CHANGE_SUMMARY>
*/

import { gitExec } from "./git-exec.ts";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export interface CommitWerkstattResult {
  committed: boolean;
  commitSha: string | null;
}

export async function commitWerkstattSideEffects(
  workspaceRoot: string,
  files: string[],
  message: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<CommitWerkstattResult> {
  for (const file of files) {
    await gitExec(workspaceRoot, `add -- ${JSON.stringify(file)}`, { allowNonZero: true });
  }

  let hasStagedChanges: boolean;
  try {
    const diffResult = await io.exec("sh", ["-c", "git diff --cached --quiet"], {
      cwd: workspaceRoot,
      timeoutMs: 30_000,
    });
    hasStagedChanges = diffResult.exitCode !== 0;
  } catch {
    hasStagedChanges = true;
  }

  if (!hasStagedChanges) {
    return { committed: false, commitSha: null };
  }

  await gitExec(workspaceRoot, `commit -m ${JSON.stringify(message)}`, {
    env: { ...process.env, ECOSYSTEM_COMMIT: "1" },
  });
  const commitSha = await gitExec(workspaceRoot, "rev-parse HEAD");

  return { committed: true, commitSha };
}