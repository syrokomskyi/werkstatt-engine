/*
<MODULE_CONTRACT>
<purpose>ADR-0088: Unit tests for JRN-01 journal mission-attribution check in sternsystem.validate.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0088: initial unit tests for JRN-01 — op-started records in cache-clone operations/*.jsonl must carry non-empty missionId.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSternsystemValidate } from "./sternsystem-validate.ts";
import { makeInput, makeContext, writeSystemConfig, BASE_SETUP } from "./test-helpers.ts";

let testRoot: string;
let workspaceRoot: string;
let cacheDir: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "journal-attribution-test-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  await BASE_SETUP(workspaceRoot);
  await writeSystemConfig(workspaceRoot, [
    { path: "../systems-cache/test-bundle", storageType: "non-bare" },
  ]);
  cacheDir = join(workspaceRoot, "..", "systems-cache", "test-bundle");
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

async function writeJournal(
  name: string,
  records: Array<Record<string, unknown>>,
): Promise<void> {
  const operationsDir = join(cacheDir, "operations");
  await mkdir(operationsDir, { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(join(operationsDir, name), lines, "utf8");
}

function opStarted(opId: string, op: string, missionId: string): Record<string, unknown> {
  return {
    kind: "op-started",
    opId,
    op,
    missionId,
    at: "2026-09-21T00:00:00.000Z",
    platformVersion: "",
  };
}

function jrn01Violations(result: Awaited<ReturnType<typeof runSternsystemValidate>>) {
  return result.data?.violations?.filter((v: { rule: string }) => v.rule === "JRN-01") ?? [];
}

function jrn01Warnings(result: Awaited<ReturnType<typeof runSternsystemValidate>>) {
  return result.data?.warnings?.filter((w: { field: string }) => w.field === "JRN-01") ?? [];
}

test("JRN-01 emitted for op-started with empty missionId", async () => {
  await writeJournal("ship-test-m000001.jsonl", [
    opStarted("op-1", "leitstand.ship", ""),
    { kind: "op-done", opId: "op-1", at: "2026-09-21T00:01:00.000Z" },
  ]);

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const violations = jrn01Violations(result);
  expect(
    violations.length,
    "JRN-01 must fire on op-started with empty missionId — check the missionId guard in checkJournalAttribution",
  ).toBe(1);
  expect(violations[0]?.message).toContain("op-1");
  expect(violations[0]?.message).toContain("ship-test-m000001.jsonl");
});

test("JRN-01 emitted for op-started with missing missionId field", async () => {
  const rec = opStarted("op-2", "leitstand.ship", "m-1");
  delete (rec as { missionId?: string }).missionId;
  await writeJournal("ship-test-m000002.jsonl", [rec]);

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  expect(jrn01Violations(result)).toHaveLength(1);
});

test("JRN-01 emitted once per offending op-started record", async () => {
  await writeJournal("ship-test-m000003.jsonl", [
    opStarted("op-a", "leitstand.ship", ""),
    opStarted("op-b", "leitstand.ship", "m-1"),
    opStarted("op-c", "leitstand.ship", "  "),
  ]);

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const violations = jrn01Violations(result);
  expect(violations).toHaveLength(2);
  expect(violations.map((v) => v.message).join(" ")).toContain("op-a");
  expect(violations.map((v) => v.message).join(" ")).toContain("op-c");
});

test("JRN-01 not emitted when all op-started carry missionId", async () => {
  await writeJournal("ship-test-m000004.jsonl", [
    opStarted("op-1", "leitstand.ship", "test-m000004"),
    { kind: "op-done", opId: "op-1", at: "2026-09-21T00:01:00.000Z" },
  ]);

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  expect(jrn01Violations(result)).toHaveLength(0);
});

test("JRN-01 not emitted when operations dir is absent", async () => {
  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  expect(jrn01Violations(result)).toHaveLength(0);
});

test("unreadable journal produces JRN-01 warning, not violation", async () => {
  const operationsDir = join(cacheDir, "operations");
  await mkdir(operationsDir, { recursive: true });
  await writeFile(join(operationsDir, "corrupt.jsonl"), "{not json\n", "utf8");

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  expect(jrn01Violations(result)).toHaveLength(0);
  const warnings = jrn01Warnings(result);
  expect(warnings.length).toBeGreaterThanOrEqual(1);
  expect(warnings[0]?.message).toContain("corrupt.jsonl");
});
