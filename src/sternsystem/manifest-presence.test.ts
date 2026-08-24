/*
<MODULE_CONTRACT>
<purpose>RFC-0870: Unit tests for STERN-MANIFEST-01 check in sternsystem.validate.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0870: initial unit tests for manifest presence check.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSternsystemValidate } from "./sternsystem-validate.ts";
import { makeInput, makeContext, writeSystemConfig, BASE_SETUP } from "./test-helpers.ts";

let testRoot: string;
let workspaceRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "manifest-presence-test-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  await BASE_SETUP(workspaceRoot);
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  execSync("git config user.name Test", { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
}

function gitCommit(dir: string): void {
  execSync("git add -A", { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  execSync("git commit -m test", { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
}

test("STERN-MANIFEST-01 not emitted when manifests are present in HEAD", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "../systems-cache/test-bundle", storageType: "non-bare" },
  ]);

  const cacheDir = join(workspaceRoot, "..", "systems-cache", "test-bundle");
  initGitRepo(cacheDir);
  await mkdir(join(cacheDir, "src"), { recursive: true });
  await writeFile(join(cacheDir, "src", "image-variants.generated.yaml"), "version: 1\n", "utf8");
  await writeFile(join(cacheDir, "src", "video-manifest.generated.yaml"), "version: 1\n", "utf8");
  await writeFile(
    join(cacheDir, "src", "live-video-manifest.generated.yaml"),
    "version: 1\n",
    "utf8",
  );
  gitCommit(cacheDir);

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const manifestViolations =
    result.data?.violations?.filter((v: { rule: string }) => v.rule === "STERN-MANIFEST-01") ?? [];
  expect(manifestViolations).toHaveLength(0);
});

test("STERN-MANIFEST-01 emitted for tracked manifest missing from HEAD", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "../systems-cache/test-bundle", storageType: "non-bare" },
  ]);

  const cacheDir = join(workspaceRoot, "..", "systems-cache", "test-bundle");
  initGitRepo(cacheDir);
  await mkdir(join(cacheDir, "src"), { recursive: true });
  await writeFile(join(cacheDir, "src", "image-variants.generated.yaml"), "version: 1\n", "utf8");
  await writeFile(join(cacheDir, "src", "video-manifest.generated.yaml"), "version: 1\n", "utf8");
  await writeFile(
    join(cacheDir, "src", "live-video-manifest.generated.yaml"),
    "version: 1\n",
    "utf8",
  );
  gitCommit(cacheDir);

  // Remove one manifest and commit the deletion
  await rm(join(cacheDir, "src", "image-variants.generated.yaml"));
  gitCommit(cacheDir);

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const manifestViolations =
    result.data?.violations?.filter((v: { rule: string }) => v.rule === "STERN-MANIFEST-01") ?? [];
  expect(manifestViolations.length).toBeGreaterThanOrEqual(1);
  expect(manifestViolations[0]?.message).toContain("image-variants.generated.yaml");
});

test("STERN-MANIFEST-01 not emitted for new systems without tracked manifests", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "../systems-cache/test-bundle", storageType: "non-bare" },
  ]);

  const cacheDir = join(workspaceRoot, "..", "systems-cache", "test-bundle");
  initGitRepo(cacheDir);
  // No manifest files at all — new system
  await writeFile(join(cacheDir, "README.md"), "# test\n", "utf8");
  gitCommit(cacheDir);

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const manifestViolations =
    result.data?.violations?.filter((v: { rule: string }) => v.rule === "STERN-MANIFEST-01") ?? [];
  expect(manifestViolations).toHaveLength(0);
});
