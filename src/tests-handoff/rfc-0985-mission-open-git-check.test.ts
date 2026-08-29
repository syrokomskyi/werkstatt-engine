/*
<MODULE_CONTRACT>
  <purpose>RFC-0985: unit tests for mission.open pre-flight git check (Measure 4) and crash-safe rollback marker (Measure 7).</purpose>
  <keywords>RFC-0985, mission.open, detached HEAD, rebase-merge, rollback marker, crash-safe</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0985: initial tests for pre-flight git sanity check and rollback marker.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { buildOpenSteps, type OpenStepCtx } from "../mission/mission-open.ts";
import type { OperationStep } from "../journal/index.ts";

let tmpDir: string;
let cacheCloneDir: string;
let systemId: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-rfc0985-open-"));
  systemId = `test-sys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // resolveCacheClonePath uses ../systems-cache/<id> relative to workspaceRoot
  cacheCloneDir = join(tmpDir, "..", "systems-cache", systemId);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(cacheCloneDir, { recursive: true, force: true });
});

function makeOpenCtx(overrides?: Partial<OpenStepCtx>): OpenStepCtx {
  return {
    workspaceRoot: tmpDir,
    systemId,
    missionId: `${systemId}-m000001`,
    manifest: {
      schemaVersion: "1.0.0",
      missionId: `${systemId}-m000001`,
      systemId,
      state: "open",
      brief: "Test",
      openedAt: "2026-01-01T00:00:00.000Z",
      openedBy: "test-agent",
      closedAt: null,
      closedBy: null,
      pinAtOpen: "1.0.0",
      materializedAt: null,
      migratedAt: null,
      reconciledAt: null,
      releaseId: null,
      rfcId: null,
      operationId: "op-001",
    } as any,
    actor: { handle: "test-agent", role: "operator" } as any,
    now: "2026-08-29T00:00:00.000Z",
    pinAtOpen: "1.0.0",
    operationId: "op-001",
    staleEntries: { hasStaleEntries: false, staleEntries: [] } as any,
    context: {
      workspaceRoot: tmpDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        success: () => {},
        debug: () => {},
      },
    } as any,
    state: { currentMission: null } as any,
    materializedAt: null,
    ...overrides,
  };
}

function makeCacheCloneDir(): string {
  mkdirSync(cacheCloneDir, { recursive: true });
  // Initialize a real git repo so git symbolic-ref HEAD works
  execSync("git init -b main", { cwd: cacheCloneDir, stdio: ["pipe", "pipe", "pipe"] });
  return cacheCloneDir;
}

test("Measure 4: cache-clone-git-check step exists in buildOpenSteps", async () => {
  const ctx = makeOpenCtx();
  const steps = await buildOpenSteps(tmpDir, ctx.missionId, ctx);
  const step = steps.find((s: OperationStep<unknown>) => s.name === "cache-clone-git-check");
  expect(step, "cache-clone-git-check step must exist").toBeDefined();
});

test("Measure 4: cache-clone-git-check passes when no cache clone .git exists", async () => {
  const ctx = makeOpenCtx();
  const steps = await buildOpenSteps(tmpDir, ctx.missionId, ctx);
  const step = steps.find((s: OperationStep<unknown>) => s.name === "cache-clone-git-check")!;

  // No cache clone directory at all — step should not throw
  await expect(step.run(ctx)).resolves.not.toThrow();
});

test("Measure 4: cache-clone-git-check throws on stale rebase-merge directory", async () => {
  const ctx = makeOpenCtx();
  const cacheDir = makeCacheCloneDir();
  // Create stale rebase-merge directory on top of valid git repo
  mkdirSync(join(cacheDir, ".git", "rebase-merge"), { recursive: true });

  const steps = await buildOpenSteps(tmpDir, ctx.missionId, ctx);
  const step = steps.find((s: OperationStep<unknown>) => s.name === "cache-clone-git-check")!;

  await expect(step.run(ctx)).rejects.toThrow(/stale rebase-merge/);
});

test("Measure 4: cache-clone-git-check error message includes actionable hint", async () => {
  const ctx = makeOpenCtx();
  const cacheDir = makeCacheCloneDir();
  mkdirSync(join(cacheDir, ".git", "rebase-merge"), { recursive: true });

  const steps = await buildOpenSteps(tmpDir, ctx.missionId, ctx);
  const step = steps.find((s: OperationStep<unknown>) => s.name === "cache-clone-git-check")!;

  try {
    await step.run(ctx);
    expect.fail("Should have thrown");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg, "error must include rebase --abort hint").toContain("rebase --abort");
  }
});

test("Measure 7: rollback-marker-check step exists in buildOpenSteps", async () => {
  const ctx = makeOpenCtx();
  const steps = await buildOpenSteps(tmpDir, ctx.missionId, ctx);
  const step = steps.find((s: OperationStep<unknown>) => s.name === "rollback-marker-check");
  expect(step, "rollback-marker-check step must exist").toBeDefined();
});

test("Measure 7: rollback-marker-check passes when no missions directory exists", async () => {
  const ctx = makeOpenCtx();
  const steps = await buildOpenSteps(tmpDir, ctx.missionId, ctx);
  const step = steps.find((s: OperationStep<unknown>) => s.name === "rollback-marker-check")!;

  await expect(step.run(ctx)).resolves.not.toThrow();
});

test("Measure 7: rollback-marker-check removes stale mission dir when marker found", async () => {
  const ctx = makeOpenCtx();
  const missionsDir = join(tmpDir, "missions");
  const staleMissionDir = join(missionsDir, "test-sys-m000099");
  mkdirSync(staleMissionDir, { recursive: true });
  // Write the rollback-pending marker
  writeFileSync(join(staleMissionDir, ".rollback-pending"), "");

  const steps = await buildOpenSteps(tmpDir, ctx.missionId, ctx);
  const step = steps.find((s: OperationStep<unknown>) => s.name === "rollback-marker-check")!;

  await step.run(ctx);

  expect(
    existsSync(staleMissionDir),
    "stale mission dir with rollback marker should be removed",
  ).toBe(false);
});

test("Measure 7: rollback-marker-check does not remove mission dir without marker", async () => {
  const ctx = makeOpenCtx();
  const missionsDir = join(tmpDir, "missions");
  const normalMissionDir = join(missionsDir, "test-sys-m000050");
  mkdirSync(normalMissionDir, { recursive: true });
  // No .rollback-pending marker

  const steps = await buildOpenSteps(tmpDir, ctx.missionId, ctx);
  const step = steps.find((s: OperationStep<unknown>) => s.name === "rollback-marker-check")!;

  await step.run(ctx);

  expect(existsSync(normalMissionDir), "mission dir without marker should NOT be removed").toBe(
    true,
  );
});

test("Measure 7: rollback-marker-check skips archive directory", async () => {
  const ctx = makeOpenCtx();
  const missionsDir = join(tmpDir, "missions");
  const archiveDir = join(missionsDir, "archive", "aborted", "test-sys-m000099");
  mkdirSync(archiveDir, { recursive: true });
  // Put a marker in archive — should NOT be touched
  writeFileSync(join(archiveDir, ".rollback-pending"), "");

  const steps = await buildOpenSteps(tmpDir, ctx.missionId, ctx);
  const step = steps.find((s: OperationStep<unknown>) => s.name === "rollback-marker-check")!;

  await step.run(ctx);

  expect(
    existsSync(archiveDir),
    "archive directory should not be processed by rollback-marker-check",
  ).toBe(true);
});

test("Measure 4+7: cache-clone-git-check runs before rollback-marker-check", async () => {
  const ctx = makeOpenCtx();
  const steps = await buildOpenSteps(tmpDir, ctx.missionId, ctx);
  const gitCheckIdx = steps.findIndex(
    (s: OperationStep<unknown>) => s.name === "cache-clone-git-check",
  );
  const rollbackIdx = steps.findIndex(
    (s: OperationStep<unknown>) => s.name === "rollback-marker-check",
  );

  expect(gitCheckIdx, "cache-clone-git-check must exist").toBeGreaterThanOrEqual(0);
  expect(rollbackIdx, "rollback-marker-check must exist").toBeGreaterThanOrEqual(0);
  expect(gitCheckIdx, "cache-clone-git-check must come before rollback-marker-check").toBeLessThan(
    rollbackIdx,
  );
});
