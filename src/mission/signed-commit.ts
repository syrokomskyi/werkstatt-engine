/*
<MODULE_CONTRACT>
<purpose>RFC-0560: Ed25519 signed commit helper for mission workpiece git commits.</purpose>
<non-goals>
  <item>Does not verify signatures — verification is a future RFC.</item>
  <item>Does not handle GPG signing — uses Ed25519 via @warpgogol/werkstatt-shared/passport signBytes.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0560: initial signed commit helper using Ed25519 via @warpgogol/werkstatt-shared/passport.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
</CHANGE_SUMMARY>
*/

import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import path from "node:path";
import { signBytes } from "@warpgogol/werkstatt-shared/passport";

export interface SignedCommitResult {
  commitSha: string;
  signed: boolean;
  actorId: string | null;
  signature: string | null;
}

async function git(cwd: string, args: string[], io: WorkspaceIO): Promise<string> {
  const result = await io.exec("git", args, {
    cwd,
    env: { MISSION_GIT_COMMIT: "1" },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args[0] ?? ""} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

export async function createSignedCommit(
  workpieceDir: string,
  message: string,
  actorId: string,
  privateKeyHex: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<SignedCommitResult> {
  if (!(await io.exists(path.join(workpieceDir, ".git")))) {
    throw new Error(
      `[createSignedCommit] workpiece is not a git repository — run mission.materialize first`,
    );
  }

  await git(workpieceDir, ["add", "-A"], io);

  let hasChanges: boolean;
  try {
    await git(workpieceDir, ["diff", "--cached", "--quiet"], io);
    hasChanges = false;
  } catch {
    hasChanges = true;
  }

  if (!hasChanges) {
    return {
      commitSha: await git(workpieceDir, ["rev-parse", "HEAD"], io),
      signed: false,
      actorId: null,
      signature: null,
    };
  }

  await git(workpieceDir, ["commit", "-m", message], io);
  const preAmendSha = await git(workpieceDir, ["rev-parse", "HEAD"], io);

  const signature = await signBytes(privateKeyHex, new TextEncoder().encode(preAmendSha));

  const amendedMessage = `${message}\n\nWerkstatt-Actor: ${actorId}\nWerkstatt-Signature: ${signature}`;
  await git(workpieceDir, ["commit", "--amend", "-m", amendedMessage], io);

  const postAmendSha = await git(workpieceDir, ["rev-parse", "HEAD"], io);

  return {
    commitSha: postAmendSha,
    signed: true,
    actorId,
    signature,
  };
}
