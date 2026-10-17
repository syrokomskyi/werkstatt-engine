/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1221: integration regression — mission.reconcile must record every
    folded workpiece commit in the bordbuch mission-reconcile entry's
    metadata.mergedShas[], derived from the merge commit's parents, including
    the operator-resolve fold path and journal resume where
    record-pre-reconcile-sha was skipped. Regression for warpgogol-m000192
    (a2b4770/412ebe06: empty mergedShas, null/self preReconcileSha → folded
    workpiece commits later flagged as external edits).
  </purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1221: initial test — fold-path mergedShas from merge parents, resume path, no-op entry shape, rev-list failure non-fatal, guard replay.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { expectData } from "../tests-handoff/helpers/kernel-result-helpers.ts";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function gitInit(dir: string): void {
  git(dir, "init -b main");
  git(dir, 'config user.email "test@example.com"');
  git(dir, 'config user.name "Test"');
}

function gitCommitAll(dir: string, msg: string): string {
  git(dir, "add -A");
  git(dir, `commit -m ${JSON.stringify(msg)}`);
  return git(dir, "rev-parse HEAD");
}

let testRoot: string;
let tmpWorkspace: string;
let cacheDir: string;
let workpieceDir: string;
let missionDir: string;

interface ReconcileEntry {
  kind?: string;
  metadata?: {
    commitSha?: string;
    preReconcileSha?: string | null;
    mergedShas?: string[];
    transferredCommits?: number;
  };
}

function readBordbuchEntries(): ReconcileEntry[] {
  const raw = readFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ReconcileEntry);
}

function lastReconcileEntry(): ReconcileEntry {
  const entries = readBordbuchEntries().filter((e) => e.kind === "mission-reconcile");
  const last = entries[entries.length - 1];
  if (!last) throw new Error("no mission-reconcile bordbuch entry written");
  return last;
}

interface ReconcileReport {
  mergeCommitSha?: string | null;
}

function readReconcileReport(): ReconcileReport {
  return JSON.parse(
    readFileSync(join(missionDir, "evidence", "reconciliation-report.json"), "utf-8"),
  ) as ReconcileReport;
}

function workpieceCommit(file: string, content: string, subject: string): string {
  const abs = join(workpieceDir, file);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
  return gitCommitAll(workpieceDir, subject);
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rfc-1221-"));
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
  // Subject carries a pipeline-authored prefix so the external-edit guard
  // whitelist covers the fixture's own bookkeeping history.
  gitCommitAll(cacheDir, "cache-clone: initial system");

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

  workpieceDir = join(missionDir, "workpiece");
  execSync(`git clone ${JSON.stringify(cacheDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

async function runReconcile(opts?: { failFoldedRevList?: boolean }) {
  const warnings: string[] = [];
  const baseIo = createDefaultIO().io;
  const io: WorkspaceIO = opts?.failFoldedRevList
    ? {
        ...baseIo,
        exec: ((command: string, args: string[], o?: unknown) => {
          const shell = typeof args?.[1] === "string" ? args[1] : "";
          if (command === "sh" && shell.includes("rev-list") && shell.includes("--not")) {
            return Promise.resolve({
              exitCode: 1,
              stdout: "",
              stderr: "injected rev-list failure",
            });
          }
          return baseIo.exec(command, args, o as never);
        }) as WorkspaceIO["exec"],
      }
    : baseIo;
  const { runMissionReconcile } = await import("./mission-materialization-commands.ts");
  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    io,
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: (m: string) => warnings.push(m) },
  } as unknown as KernelRuntimeContext;
  const result = await runMissionReconcile(input, context);
  return { result, warnings };
}

// AC-1 + AC-2 baseline: a plain --no-ff merge records every newly-reachable
// workpiece commit and the truthful pre-merge head.
test("records every folded workpiece commit on a plain merge", async () => {
  const w1 = workpieceCommit("src/content/one.md", "# One\n", "wp: add page one");
  const w2 = workpieceCommit("src/content/two.md", "# Two\n", "wp: add page two");
  const cacheHeadBefore = git(cacheDir, "rev-parse HEAD");

  const { result } = await runReconcile();
  const data = expectData(result);

  const entry = lastReconcileEntry();
  expect(entry.metadata?.commitSha).toBe(data.commitSha);
  expect(entry.metadata?.mergedShas?.slice().sort()).toEqual([w1, w2].sort());
  expect(entry.metadata?.transferredCommits).toBe(2);
  expect(entry.metadata?.preReconcileSha).toBe(cacheHeadBefore);
  // The merge's first parent IS the cache-clone head the merge started from.
  expect(git(cacheDir, `rev-parse ${data.commitSha}^1`)).toBe(cacheHeadBefore);
  // mergeCommitSha records the merge commit itself — commitSha — not the
  // parent of whatever post-merge commit happens to be HEAD.
  expect(readReconcileReport().mergeCommitSha).toBe(data.commitSha);
});

// AC-1 + AC-2: the m000192 fold path — the workpiece already contains the
// cache-clone head (operator resolved the conflict inside the workpiece), so
// the reconcile merge folds a merge commit. The folded set must list the
// operator merge plus its workpiece-side commits — and must NOT include the
// cache-clone-side bookkeeping commit that is reachable through the merge's
// second parent but already an ancestor of the first.
test("records folded commits when the workpiece already merged the cache head", async () => {
  const w1 = workpieceCommit("src/content/one.md", "# One\n", "wp: add page one");
  const w2 = workpieceCommit("src/content/two.md", "# Two\n", "wp: add page two");

  // Cache clone moves ahead after the workpiece was cloned (bookkeeping).
  writeFileSync(join(cacheDir, "state-change.yaml"), "touched: true\n");
  const bookkeepingSha = gitCommitAll(cacheDir, "Bordbuch: mirror-sync test-system");

  // Operator-resolve inside the workpiece: fold the cache head in.
  git(workpieceDir, "fetch origin");
  git(workpieceDir, `merge origin/main -m "merge: resolve reconcile conflicts"`);
  const operatorMergeSha = git(workpieceDir, "rev-parse HEAD");

  const { result } = await runReconcile();
  const data = expectData(result);

  const entry = lastReconcileEntry();
  const merged = entry.metadata?.mergedShas ?? [];
  expect(merged.slice().sort()).toEqual([w1, w2, operatorMergeSha].sort());
  expect(merged).not.toContain(bookkeepingSha);
  expect(entry.metadata?.transferredCommits).toBe(3);
  expect(entry.metadata?.preReconcileSha).toBe(bookkeepingSha);
  expect(entry.metadata?.preReconcileSha).not.toBe(data.commitSha);
});

// AC-2: resume after a crash — record-pre-reconcile-sha is already step-done
// in the journal, so it is skipped and cc.preReconcileSha stays null. The
// count step must still produce mergedShas and recover preReconcileSha from
// the merge commit's first parent (the self-range/null regression).
test("journal-resumed reconcile still records mergedShas and truthful preReconcileSha", async () => {
  const w1 = workpieceCommit("src/content/one.md", "# One\n", "wp: add page one");
  const cacheHeadBefore = git(cacheDir, "rev-parse HEAD");

  const doneSteps = [
    "workpiece-git-check",
    "auto-commit-workpiece",
    "auto-commit-cache-clone",
    "dirty-cache-clone-guard",
    "record-pre-reconcile-sha",
  ];
  const records: Record<string, unknown>[] = [
    {
      kind: "op-started",
      opId: "reconcile-op-1",
      op: "mission.reconcile",
      missionId: "test-system-m000001",
      at: "t0",
      platformVersion: "",
    },
  ];
  doneSteps.forEach((step, i) => {
    records.push(
      { kind: "step-started", opId: "reconcile-op-1", step, seq: i, at: `t${i}` },
      { kind: "step-done", opId: "reconcile-op-1", step, seq: i, at: `t${i}b` },
    );
  });
  records.push(
    {
      kind: "step-started",
      opId: "reconcile-op-1",
      step: "fetch-and-merge",
      seq: 5,
      at: "t9",
    },
    {
      kind: "step-failed",
      opId: "reconcile-op-1",
      step: "fetch-and-merge",
      seq: 5,
      at: "t10",
      error: "merge conflict",
    },
    { kind: "op-interrupted", opId: "reconcile-op-1", at: "t11", failedStep: "fetch-and-merge" },
  );
  writeFileSync(
    join(missionDir, "journal.jsonl"),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );

  const { result } = await runReconcile();
  const data = expectData(result);

  expect(data.mergedShas).toEqual([w1]);
  const entry = lastReconcileEntry();
  expect(entry.metadata?.mergedShas).toEqual([w1]);
  expect(entry.metadata?.preReconcileSha).toBe(cacheHeadBefore);
  expect(entry.metadata?.preReconcileSha).not.toBe(data.commitSha);
});

// AC-3: a no-op reconcile (workpiece already merged, nothing to fold) writes
// the entry WITHOUT mergedShas and does not fail.
test("no-op reconcile writes the entry without mergedShas", async () => {
  const { result } = await runReconcile();
  const data = expectData(result);

  expect(data.mergedShas).toEqual([]);
  const entry = lastReconcileEntry();
  expect(entry.metadata?.mergedShas).toBeUndefined();
  expect(entry.metadata?.transferredCommits).toBe(0);
  expect(entry.metadata?.commitSha).toBeTruthy();
  // No merge commit was created — mergeCommitSha stays null.
  expect(readReconcileReport().mergeCommitSha).toBeNull();
});

// AC-3 (failure leg): folded-SHA computation failure is non-fatal — the
// reconcile succeeds, the entry is written without mergedShas, and a warning
// is logged.
test("rev-list failure keeps reconcile green and omits mergedShas", async () => {
  workpieceCommit("src/content/one.md", "# One\n", "wp: add page one");

  const { result, warnings } = await runReconcile({ failFoldedRevList: true });
  const data = expectData(result);

  expect(data.commitSha).toBeTruthy();
  expect(data.mergedShas).toEqual([]);
  const entry = lastReconcileEntry();
  expect(entry.metadata?.mergedShas).toBeUndefined();
  expect(entry.metadata?.commitSha).toBe(data.commitSha);
  expect(warnings.some((w) => w.includes("folded-SHA computation failed"))).toBe(true);
});

// AC-4: after a fold reconcile, the external-edit guard (same collector +
// gate as sternsystem.validate) must treat every folded workpiece commit as
// pipeline-authored — nothing is reported as external-edit-detected.
test("external-edit guard passes folded workpiece commits after fold reconcile", async () => {
  const w1 = workpieceCommit("src/content/one.md", "# One\n", "wp: add page one");
  const w2 = workpieceCommit("src/content/two.md", "# Two\n", "wp: add page two");

  writeFileSync(join(cacheDir, "state-change.yaml"), "touched: true\n");
  gitCommitAll(cacheDir, "Bordbuch: mirror-sync test-system");

  git(workpieceDir, "fetch origin");
  git(workpieceDir, `merge origin/main -m "merge: resolve reconcile conflicts"`);
  const operatorMergeSha = git(workpieceDir, "rev-parse HEAD");

  const { result } = await runReconcile();
  expectData(result);

  const { collectExternalEditInputs, bordbuchPathFor } =
    await import("../sternsystem/external-edit-collector.ts");
  const { evaluateExternalEditGate } = await import("../sternsystem/external-edit-guard.ts");
  const inputs = await collectExternalEditInputs(cacheDir, bordbuchPathFor(cacheDir));
  const guard = evaluateExternalEditGate({ systemId: "test-system", ...inputs });
  expect(guard.verdict).toBe("pass");

  // Negative control: reproduce the m000192 shape — mergedShas absent AND a
  // null preReconcileSha (skipped record step) meaning no rangeShas trace —
  // then the same folded commits must flag. Proves mergedShas is the trace
  // that survives when the range cannot be computed.
  const stripped = evaluateExternalEditGate({
    systemId: "test-system",
    ...inputs,
    bordbuchEntries: inputs.bordbuchEntries.map((e) => ({
      ...e,
      metadata: { ...e.metadata, mergedShas: [], preReconcileSha: undefined },
    })),
    rangeShas: [],
  });
  expect(stripped.verdict).toBe("fail");
  expect(stripped.violations[0]?.rule).toBe("external-edit-detected");
  // Non-merge workpiece commits stay reachable (same SHAs) in the cache-clone
  // log — commitAndPushBordbuch's pull --rebase linearizes merge commits out
  // of the ancestry (pre-existing RFC-0987 behavior), which is exactly why
  // mergedShas must carry the fold record: the merge-commit SHAs it lists may
  // legitimately be unreachable afterwards while the folded work commits keep
  // their SHAs. The guard must still see the work commits as authored.
  for (const sha of [w1, w2]) {
    expect(inputs.gitLogShas).toContain(sha);
  }
  const entry = lastReconcileEntry();
  expect(entry.metadata?.mergedShas).toContain(operatorMergeSha);
});
