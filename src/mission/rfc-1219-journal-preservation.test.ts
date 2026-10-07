/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1219: integration test — operation journals under operations/ survive
    the record-pre-reconcile-sha rewind (git reset --hard to the previous
    reconcile's preReconcileSha). Regression for warpgogol-m000192, where the
    mid-run ship journal was committed by auto-commit-cache-clone, then wiped
    by the rewind, leaving an orphan step-failed and no resumable op.
  </purpose>
  <keywords>RFC-1219, mission.reconcile, journal, reset --hard, operations, resume</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1219: initial test — journal preservation across pre-reconcile rewind.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { expectData } from "../tests-handoff/helpers/kernel-result-helpers.ts";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function gitInit(dir: string): void {
  git(dir, "init");
  git(dir, 'config user.email "test@example.com"');
  git(dir, 'config user.name "Test"');
}

function gitCommitAll(dir: string, msg: string): void {
  git(dir, "add -A");
  git(dir, `commit -m ${JSON.stringify(msg)}`);
}

let testRoot: string;
let tmpWorkspace: string;
let cacheDir: string;
let workpieceDir: string;
let missionDir: string;
let initialSha: string;

const JOURNAL_REL = join("operations", "ship-test-system-m000001.jsonl");
const JOURNAL_CONTENT =
  '{"kind":"op-started","opId":"op-ship-1","op":"leitstand.ship","missionId":"test-system-m000001","at":"t0"}\n' +
  '{"kind":"step-started","opId":"op-ship-1","step":"preflight","seq":0,"at":"t1"}\n' +
  '{"kind":"step-done","opId":"op-ship-1","step":"preflight","seq":0,"at":"t2"}\n';

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rfc-1219-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
  gitInit(tmpWorkspace);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommitAll(tmpWorkspace, "initial");

  cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(cacheDir, "system-config.yaml"),
    `schemaVersion: system-config/v1
id: test-system
cosmicStar: Vega
mirrors:
  - path: "../systems-cache/test-system"
    storageType: non-bare
  - path: "../systems-cache/test-system.git"
    storageType: bare
pinnedPlatform: "4.5.0"
status: active
registeredAt: "2026-01-01T00:00:00Z"
notes: ""
`,
  );
  writeFileSync(
    join(cacheDir, "system-state.yaml"),
    `schemaVersion: system-state/v1
systemId: test-system
currentMission: test-system-m000001
lastRelease: null
`,
  );

  gitInit(cacheDir);
  mkdirSync(join(cacheDir, "src", "content"), { recursive: true });
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  writeFileSync(join(cacheDir, "src", "content", "system.md"), "# System\n");
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "");
  gitCommitAll(cacheDir, "initial system");
  // The previous reconcile's preReconcileSha — the rewind target. At this
  // commit, operations/ does not exist.
  initialSha = git(cacheDir, "rev-parse HEAD");

  const bareDir = join(testRoot, "systems-cache", "test-system.git");
  execSync(`git clone --bare ${JSON.stringify(cacheDir)} ${JSON.stringify(bareDir)}`, {
    stdio: "pipe",
  });
  git(cacheDir, `remote add origin ${JSON.stringify(bareDir)}`);

  missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  mkdirSync(join(missionDir, "evidence"), { recursive: true });
  const manifest = {
    schemaVersion: "1.0.0",
    missionId: "test-system-m000001",
    systemId: "test-system",
    state: "open",
    brief: "Test mission",
    openedAt: "2026-08-05T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: "2026-08-05T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: null,
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(
    join(missionDir, "evidence", "validation-report.json"),
    JSON.stringify({ contractFull: { passed: true }, timestamp: "2026-08-05T01:30:00.000Z" }) +
      "\n",
  );
  // A previous reconcile ran: its report carries the rewind target — before
  // the journal commit.
  writeFileSync(
    join(missionDir, "evidence", "reconciliation-report.json"),
    JSON.stringify({ preReconcileSha: initialSha }) + "\n",
  );

  workpieceDir = join(missionDir, "workpiece");
  execSync(`git clone ${JSON.stringify(cacheDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');

  // Simulate the m000192 sequence: AFTER materialization (workpiece cloned),
  // the in-flight ship journal is committed mid-run by
  // auto-commit-cache-clone — tracked at the cache-clone's pre-reset HEAD but
  // absent both at the rewind target AND in the workpiece history, so only
  // the preservation step can keep it.
  mkdirSync(join(cacheDir, "operations"), { recursive: true });
  writeFileSync(join(cacheDir, JOURNAL_REL), JOURNAL_CONTENT);
  git(cacheDir, `add -- ${JSON.stringify(JOURNAL_REL)}`);
  git(cacheDir, 'commit -m "cache-clone: auto-commit operational files"');
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

async function runReconcile() {
  const { runMissionReconcile } = await import("./mission-materialization-commands.ts");
  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;
  return runMissionReconcile(input, context);
}

// AC-5: the rewind would delete the tracked journal (absent at the reset
// target); the preservation step restores operations/ from the pre-reset
// HEAD and commits it so the merge starts tracked-clean.
test("operations journals survive the pre-reconcile rewind", async () => {
  // Give the workpiece a mergeable change so reconcile runs the full path.
  writeFileSync(join(workpieceDir, "src", "content", "new.md"), "# New\n");
  gitCommitAll(workpieceDir, "wp edit");

  const result = await runReconcile();
  expectData(result);

  // The journal still exists in the worktree with its pre-rewind content.
  const journalPath = join(cacheDir, JOURNAL_REL);
  expect(existsSync(journalPath)).toBe(true);
  expect(readFileSync(journalPath, "utf-8")).toBe(JOURNAL_CONTENT);

  // It is tracked in HEAD — the preservation re-commit (or the merge) kept it.
  expect(git(cacheDir, `cat-file -e HEAD:${JOURNAL_REL} ; echo tracked`)).toBe("tracked");
  expect(git(cacheDir, `show HEAD:${JOURNAL_REL}`)).toBe(JOURNAL_CONTENT.trimEnd());
});

test("preservation is committed before the merge when operations/ was rewound", async () => {
  writeFileSync(join(workpieceDir, "src", "content", "new.md"), "# New\n");
  gitCommitAll(workpieceDir, "wp edit");

  await runReconcile();

  const log = git(cacheDir, "log --format=%s -20");
  expect(log).toContain("preserve operations journals across reconcile rewind");
});
