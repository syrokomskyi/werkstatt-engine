/*
<MODULE_CONTRACT>
<purpose>RFC-0792: Unit tests for YAML syntax checking in sternsystem.validate.</purpose>
<keywords>RFC-0792, yaml, syntax, validate, validation rules, unit test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0792: initial unit tests for yaml-syntax-error validation rule.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { runSternsystemValidate } from "./sternsystem-validate.ts";
import { makeInput, makeContext, writeSystemConfig, BASE_SETUP } from "./test-helpers.ts";

let testRoot: string;
let workspaceRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "yaml-syntax-validate-test-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  await BASE_SETUP(workspaceRoot);
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

test("valid YAML files produce no yaml-syntax-error violations", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "../systems-cache/test-bundle", storageType: "non-bare" },
  ]);

  const cacheDir = join(workspaceRoot, "..", "systems-cache", "test-bundle");
  const validDnsRecords = {
    records: [{ type: "A", name: "example.com", content: "1.2.3.4" }],
  };
  await writeFile(join(cacheDir, "dns-records.yaml"), stringifyYaml(validDnsRecords), "utf8");

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const yamlViolations = result.data!.violations.filter((v) => v.rule === "yaml-syntax-error");
  expect(yamlViolations).toHaveLength(0);
});

test("broken YAML file produces yaml-syntax-error violation with file name and error message", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "../systems-cache/test-bundle", storageType: "non-bare" },
  ]);

  const cacheDir = join(workspaceRoot, "..", "systems-cache", "test-bundle");
  const brokenYaml = "records:\n  - type: A\n    name: example.com\n   content: 1.2.3.4\n";
  await writeFile(join(cacheDir, "dns-records.yaml"), brokenYaml, "utf8");

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const yamlViolations = result.data!.violations.filter((v) => v.rule === "yaml-syntax-error");
  expect(yamlViolations).toHaveLength(1);
  expect(yamlViolations[0].message).toContain("dns-records.yaml");
  expect(yamlViolations[0].message).toContain("YAML syntax error");
});

test("system directory with only system-config.yaml produces no yaml-syntax-error violations", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "../systems-cache/test-bundle", storageType: "non-bare" },
  ]);

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const yamlViolations = result.data!.violations.filter((v) => v.rule === "yaml-syntax-error");
  expect(yamlViolations).toHaveLength(0);
});

test("YAML file in subdirectory is not scanned", async () => {
  await writeSystemConfig(workspaceRoot, [
    { path: "../systems-cache/test-bundle", storageType: "non-bare" },
  ]);

  const cacheDir = join(workspaceRoot, "..", "systems-cache", "test-bundle");
  await mkdir(join(cacheDir, "subdir"), { recursive: true });
  const brokenYaml = "records:\n  - type: A\n    name: example.com\n   content: 1.2.3.4\n";
  await writeFile(join(cacheDir, "subdir", "broken.yaml"), brokenYaml, "utf8");

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const yamlViolations = result.data!.violations.filter((v) => v.rule === "yaml-syntax-error");
  expect(yamlViolations).toHaveLength(0);
});
