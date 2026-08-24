/*
<MODULE_CONTRACT>
<purpose>RFC-0574: Unit tests for mirror topology validation rules in sternsystem.validate.</purpose>
<keywords>RFC-0574, mirrors, validate, validation rules, unit test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0574: initial unit tests for mirror validation rules.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSternsystemValidate } from "./sternsystem-validate.ts";
import { makeInput, makeContext, writeSystemConfig, BASE_SETUP } from "./test-helpers.ts";

let testRoot: string;
let workspaceRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "mirror-validate-test-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  await BASE_SETUP(workspaceRoot);
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

test("validate passes with single non-bare mirror (cache only)", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "./systems/test-bundle", storageType: "non-bare" },
  ]);
  await mkdir(join(workspaceRoot, "systems", "test-bundle"), { recursive: true });

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  expect(result.data!.violations).toHaveLength(0);
});

test("validate passes with 3 mirrors (cache + bare + external)", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "./systems/test-bundle", storageType: "non-bare" },
    { path: "../systems-git/test-bundle", storageType: "bare" },
    { path: "git@github.com:foo/test.git", storageType: "bare" },
  ]);
  await mkdir(join(workspaceRoot, "systems", "test-bundle"), { recursive: true });

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const mirrorViolations = result.data!.violations.filter((v) => v.rule.startsWith("mirror"));
  expect(mirrorViolations).toHaveLength(0);
});

test("validate detects embedded credentials in external mirror URL", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "./systems/test-bundle", storageType: "non-bare" },
    { path: "../systems-git/test-bundle", storageType: "bare" },
    { path: "https://user:pass@github.com/foo/test.git", storageType: "bare" },
  ]);
  await mkdir(join(workspaceRoot, "systems", "test-bundle"), { recursive: true });

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const credViolations = result.data!.violations.filter((v) => v.rule === "mirror-credentials");
  expect(credViolations).toHaveLength(1);
  expect(credViolations[0].message).toContain("credentials");
});

test("validate does not flag credentials when no external mirror exists", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "./systems/test-bundle", storageType: "non-bare" },
    { path: "../systems-git/test-bundle", storageType: "bare" },
  ]);
  await mkdir(join(workspaceRoot, "systems", "test-bundle"), { recursive: true });

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const credViolations = result.data!.violations.filter((v) => v.rule === "mirror-credentials");
  expect(credViolations).toHaveLength(0);
});

test("validate resolves cache dir from mirrors[0].path", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "../systems-cache/test-bundle", storageType: "non-bare" },
  ]);
  // Cache dir already created by writeSystemConfig

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const _cacheViolations = result.data!.violations.filter(
    (v) => v.rule === "bundle-contract" || v.rule === "cache-missing",
  );
  expect(result.exitCode).toBe(0);
});

test("validate detects mirrors[0] with wrong storageType (bare instead of non-bare)", async () => {
  await writeSystemConfig(workspaceRoot, [{ path: "./systems/test-bundle", storageType: "bare" }]);
  await mkdir(join(workspaceRoot, "systems", "test-bundle"), { recursive: true });

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const cacheViolations = result.data!.violations.filter(
    (v) => v.rule === "cache-must-be-non-bare",
  );
  expect(cacheViolations).toHaveLength(1);
  expect(cacheViolations[0].message).toContain("non-bare");
});

test("validate detects bundle storageType with git-accessible protocol", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "./systems/test-bundle", storageType: "non-bare" },
    { path: "../systems-git/test-bundle", storageType: "bare" },
    { path: "git@github.com:foo/test.git", storageType: "bundle" },
  ]);
  await mkdir(join(workspaceRoot, "systems", "test-bundle"), { recursive: true });

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const bundleViolations = result.data!.violations.filter(
    (v) => v.rule === "bundle-no-git-protocol",
  );
  expect(bundleViolations).toHaveLength(1);
  expect(bundleViolations[0].message).toContain("bundle");
  expect(bundleViolations[0].message).toContain("git");
});
