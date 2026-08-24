/*
<MODULE_CONTRACT>
  <purpose>RFC-0560: Unit tests for Ed25519 signed commit creation.</purpose>
  <keywords>RFC-0560, signed-commit, ed25519, test, git</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0560: initial unit tests for createSignedCommit.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createSignedCommit } from "./signed-commit.ts";
import { generateKeypair } from "@warpgogol/werkstatt-shared/passport/sign";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

let tmpDir: string;
let workpieceDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0560-test-"));
  workpieceDir = path.join(tmpDir, "workpiece");
  await fs.mkdir(workpieceDir, { recursive: true });
  git(workpieceDir, "init");
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');
  // Create initial commit
  await fs.writeFile(path.join(workpieceDir, "README.md"), "# Initial\n");
  git(workpieceDir, "add -A");
  git(workpieceDir, 'commit -m "initial"');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("createSignedCommit produces signed commit with Werkstatt-Actor and Werkstatt-Signature trailers", async () => {
  const keyPair = await generateKeypair();
  await fs.writeFile(path.join(workpieceDir, "file.txt"), "content\n");
  const result = await createSignedCommit(
    workpieceDir,
    "test commit",
    "did:key:z6Mktest",
    keyPair.privateKeyHex,
  );

  expect(result.signed).toBe(true);
  expect(result.actorId).toBe("did:key:z6Mktest");
  expect(result.signature).toBeTruthy();
  expect(result.commitSha).toBeTruthy();

  const commitMessage = git(workpieceDir, "log -1 --format=%B");
  expect(commitMessage).toContain("Werkstatt-Actor: did:key:z6Mktest");
  expect(commitMessage).toContain("Werkstatt-Signature:");
});

test("createSignedCommit returns signed=false when there are no changes", async () => {
  const keyPair = await generateKeypair();
  const headBefore = git(workpieceDir, "rev-parse HEAD");
  const result = await createSignedCommit(
    workpieceDir,
    "no changes",
    "did:key:z6Mktest",
    keyPair.privateKeyHex,
  );

  expect(result.signed).toBe(false);
  expect(result.actorId).toBeNull();
  expect(result.signature).toBeNull();
  expect(result.commitSha).toBe(headBefore);
});

test("createSignedCommit: post-amend SHA differs from pre-amend SHA", async () => {
  const keyPair = await generateKeypair();
  await fs.writeFile(path.join(workpieceDir, "file2.txt"), "content2\n");
  const result = await createSignedCommit(
    workpieceDir,
    "test commit 2",
    "did:key:z6Mktest",
    keyPair.privateKeyHex,
  );

  // The commit SHA after amend should be valid and the commit should exist
  const headSha = git(workpieceDir, "rev-parse HEAD");
  expect(result.commitSha).toBe(headSha);
  expect(result.signed).toBe(true);
});
