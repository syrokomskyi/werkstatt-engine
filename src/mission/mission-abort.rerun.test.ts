/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1327: mission.abort run-twice test — aborting an already-aborted mission
    is a no-op exit-0 (alreadyAborted), not a "not open" crash; the manifest and
    clone state are unchanged by the second run.
  </purpose>
<non-goals>
  <item>Not an abort-semantics test — dirty-workpiece/unreconciled guards live in the existing abort suites.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1327: initial rerun coverage — abort twice, converge.</item>
  <item>RFC-1327: run-twice idempotency — declarations, command.idempotency.validate, rerun tests, reconcile/ship/abort convergence fixes</item>
  <item>RFC-1327: explicit test timeouts on rerun tests — root vitest testTimeout is 5s</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { expectRerunSafe, snapshotGitTree } from "../testing/run-twice.ts";

function gitInit(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -qm ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let testRoot: string;
let tmpWorkspace: string;
let cacheDir: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rerun-abort-"));
  tmpWorkspace = join(testRoot, "werkstatt");
  mkdirSync(tmpWorkspace, { recursive: true });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setup(): void {
  gitInit(tmpWorkspace);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(tmpWorkspace, "initial");

  cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(cacheDir, "system-state.yaml"),
    `schemaVersion: system-state/v1
systemId: test-system
currentMission: test-system-m000001
lastRelease: null
`,
  );
  gitInit(cacheDir);
  writeFileSync(join(cacheDir, "README.md"), "# system\n");
  gitCommit(cacheDir, "initial system");

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  mkdirSync(join(missionDir, "evidence"), { recursive: true });
  writeFileSync(
    join(missionDir, "mission.yaml"),
    JSON.stringify(
      {
        schemaVersion: "1.0.0",
        missionId: "test-system-m000001",
        systemId: "test-system",
        state: "open",
        brief: "Test mission",
        openedAt: "2026-10-17T00:00:00.000Z",
        openedBy: "test-agent",
        closedAt: null,
        closedBy: null,
        pinAtOpen: "1.0.0",
        materializedAt: "2026-10-17T01:00:00.000Z",
        migratedAt: "2026-10-17T01:00:00.000Z",
        reconciledAt: "2026-10-17T02:00:00.000Z",
        releaseId: null,
        rfcId: null,
        operationId: "op-001",
      },
      null,
      2,
    ) + "\n",
  );

  const workpieceDir = join(missionDir, "workpiece");
  execSync(`git clone ${JSON.stringify(cacheDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });

  gitCommit(tmpWorkspace, "add mission");
}

test("mission.abort twice: second run is a no-op, not a crash (RFC-1327)", { timeout: 60_000 }, async () => {
  setup();
  const { runMissionAbort } = await import("./mission-abort.ts");

  const input = {
    flags: { mission: "test-system-m000001", reason: "superseded" },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  const { first, second } = await expectRerunSafe({
    run: async () => {
      const r = await runMissionAbort(input, context);
      return { exitCode: r.exitCode, status: r.exitCode === 0 ? "ok" : "failed" };
    },
    snapshot: () => `${snapshotGitTree(tmpWorkspace)}\n${snapshotGitTree(cacheDir)}`,
  });

  expect(first.exitCode).toBe(0);
  expect(second.exitCode).toBe(0);
});
