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
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { signBytes } from "@warpgogol/werkstatt-shared/passport";

export interface SignedCommitResult {
  commitSha: string;
  signed: boolean;
  actorId: string | null;
  signature: string | null;
}

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, MISSION_GIT_COMMIT: "1" },
  }).trim();
}

export async function createSignedCommit(
  workpieceDir: string,
  message: string,
  actorId: string,
  privateKeyHex: string,
): Promise<SignedCommitResult> {
  if (!existsSync(path.join(workpieceDir, ".git"))) {
    throw new Error(
      `[createSignedCommit] workpiece is not a git repository — run mission.materialize first`,
    );
  }

  git(workpieceDir, "add -A");

  let hasChanges: boolean;
  try {
    git(workpieceDir, "diff --cached --quiet");
    hasChanges = false;
  } catch {
    hasChanges = true;
  }

  if (!hasChanges) {
    return {
      commitSha: git(workpieceDir, "rev-parse HEAD"),
      signed: false,
      actorId: null,
      signature: null,
    };
  }

  git(workpieceDir, `commit -m ${JSON.stringify(message)}`);
  const preAmendSha = git(workpieceDir, "rev-parse HEAD");

  const signature = await signBytes(privateKeyHex, new TextEncoder().encode(preAmendSha));

  const amendedMessage = `${message}\n\nWerkstatt-Actor: ${actorId}\nWerkstatt-Signature: ${signature}`;
  git(workpieceDir, `commit --amend -m ${JSON.stringify(amendedMessage)}`);

  const postAmendSha = git(workpieceDir, "rev-parse HEAD");

  return {
    commitSha: postAmendSha,
    signed: true,
    actorId,
    signature,
  };
}
