/*
<MODULE_CONTRACT>
  <purpose>RFC-1199: tests for the MATERIALIZATION-IN-PROGRESS sentinel — hook
  refuses raw commits during the window, setup-staging writes the sentinel into
  the cloned .git, git-init-commit deletes it after the baseline commit and is
  idempotent on resume.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1199: initial tests — hook refuse/allow during sentinel window, setup-staging sentinel write, git-init-commit sentinel delete + idempotent resume skip.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, describe } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  buildMaterializeSteps,
  MATERIALIZATION_SENTINEL,
  type MaterializeStepCtx,
} from "../mission/mission-materialize.ts";
import { installWorkpieceCommitHook } from "../mission/workpiece-commit-hook.ts";
import { atomicMoveDir } from "../werkstatt/atomic.ts";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import type { KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

function git(cwd: string, args: string, env?: Record<string, string>): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  }).trim();
}

function gitCommitExpectFail(cwd: string, env?: Record<string, string>): { stderr: string } {
  try {
    execSync("git commit -m 'should fail'", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    throw new Error("Expected git commit to fail but it succeeded");
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    return { stderr };
  }
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-1199-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<MaterializeStepCtx>): MaterializeStepCtx {
  const io = createDefaultIO().io;
  return {
    workspaceRoot: tmpDir,
    missionId: "test-system-m000001",
    manifest: { systemId: "test-system" },
    context: { io, workspaceRoot: tmpDir } as unknown as KernelRuntimeContext,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    reportOnly: false,
    skipPreflight: true,
    force: false,
    systemDir: path.join(tmpDir, "system"),
    missionDir: path.join(tmpDir, "missions", "test-system-m000001"),
    workpieceDir: path.join(tmpDir, "missions", "test-system-m000001", "workpiece"),
    stagingDir: path.join(tmpDir, "missions", "test-system-m000001", ".staging-op-1"),
    operationId: "op-1",
    verdict: "in-sync",
    pinVersion: "1.0.0",
    platformVersion: "1.0.0",
    message: "",
    preflightSkipped: true,
    preflightSkipReason: "test",
    artifactCacheHit: false,
    artifactCacheKey: null,
    artifactCacheSkipped: false,
    cacheCloneHead: null,
    artifactCacheKeyComponents: null,
    regeneratedFiles: [],
    mediaCacheWarmed: false,
    mediaCacheSources: 0,
    bordbuchHookInstalled: false,
    clonedGitDir: null,
    prepareReport: { ok: true, steps: [] },
    workspaceGlobCheck: { stalePackages: [], ok: true },
    now: new Date().toISOString(),
    ...overrides,
  } as MaterializeStepCtx;
}

async function stepByName(name: string) {
  const steps = await buildMaterializeSteps(tmpDir, "test-system-m000001", {});
  const step = steps.find((s) => s.name === name);
  if (!step) throw new Error(`step ${name} not found`);
  return step;
}

// --- AC-4: hook refuses raw commits while the sentinel exists ---

describe("workpiece commit hook + sentinel (AC-4)", () => {
  let workpieceDir: string;

  beforeEach(async () => {
    workpieceDir = path.join(tmpDir, "workpiece");
    await fs.mkdir(workpieceDir, { recursive: true });
    git(workpieceDir, "init");
    git(workpieceDir, 'config user.email "test@example.com"');
    git(workpieceDir, 'config user.name "Test"');
    await fs.writeFile(path.join(workpieceDir, "a.txt"), "a\n");
    git(workpieceDir, "add -A");
    git(workpieceDir, 'commit -m "initial"');
    await installWorkpieceCommitHook(workpieceDir);
  });

  test("hook refuses raw git commit while sentinel exists (no MISSION_GIT_COMMIT)", async () => {
    await fs.writeFile(path.join(workpieceDir, ".git", MATERIALIZATION_SENTINEL), "{}");
    await fs.writeFile(path.join(workpieceDir, "new.txt"), "n\n");
    git(workpieceDir, "add -A");
    const { stderr } = gitCommitExpectFail(workpieceDir);
    expect(stderr).toMatch(/materialization/i);
    expect(stderr).toContain("RFC-1199");
  });

  test("hook allows MISSION_GIT_COMMIT=1 commit while sentinel exists", async () => {
    await fs.writeFile(path.join(workpieceDir, ".git", MATERIALIZATION_SENTINEL), "{}");
    await fs.writeFile(path.join(workpieceDir, "new.txt"), "n\n");
    git(workpieceDir, "add -A");
    execSync('git commit -m "pipeline commit"', {
      cwd: workpieceDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MISSION_GIT_COMMIT: "1" },
    });
    expect(git(workpieceDir, "log --oneline -1")).toContain("pipeline commit");
  });

  test("hook keeps RFC-0821 message when sentinel absent and no env", async () => {
    await fs.writeFile(path.join(workpieceDir, "new.txt"), "n\n");
    git(workpieceDir, "add -A");
    const { stderr } = gitCommitExpectFail(workpieceDir);
    expect(stderr).toContain("RFC-0821");
    expect(stderr).not.toMatch(/materialization/i);
  });
});

// --- AC-5: sentinel lifecycle in the materialize steps ---

describe("materialize step sentinel lifecycle (AC-5)", () => {
  test("setup-staging writes sentinel + hook into cloned staging .git", async () => {
    const cc = makeCtx({});
    await fs.mkdir(cc.missionDir, { recursive: true });
    // Cache clone stand-in: a real git repo with history.
    await fs.mkdir(cc.systemDir, { recursive: true });
    git(cc.systemDir, "init");
    git(cc.systemDir, 'config user.email "test@example.com"');
    git(cc.systemDir, 'config user.name "Test"');
    await fs.writeFile(path.join(cc.systemDir, "system.md"), "# sys\n");
    git(cc.systemDir, "add -A");
    git(cc.systemDir, 'commit -m "clone base"');

    const step = await stepByName("setup-staging");
    await step.run(cc);

    const sentinel = path.join(cc.stagingDir, ".git", MATERIALIZATION_SENTINEL);
    await expect(fs.stat(sentinel)).resolves.toBeTruthy();
    const payload = JSON.parse(await fs.readFile(sentinel, "utf-8"));
    expect(payload.missionId).toBe("test-system-m000001");
    await expect(
      fs.stat(path.join(cc.stagingDir, ".git", "hooks", "pre-commit")),
    ).resolves.toBeTruthy();

    // The sentinel + hook ride atomic-move into the workpiece .git.
    await fs.mkdir(path.dirname(cc.workpieceDir), { recursive: true });
    await atomicMoveDir(cc.stagingDir, cc.workpieceDir, { replace: true });
    await expect(
      fs.stat(path.join(cc.workpieceDir, ".git", MATERIALIZATION_SENTINEL)),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(cc.workpieceDir, ".git", "hooks", "pre-commit")),
    ).resolves.toBeTruthy();
  });

  test("git-init-commit deletes the sentinel after the baseline commit", async () => {
    const cc = makeCtx({});
    await fs.mkdir(cc.workpieceDir, { recursive: true });
    git(cc.workpieceDir, "init");
    git(cc.workpieceDir, 'config user.email "test@example.com"');
    git(cc.workpieceDir, 'config user.name "Test"');
    await fs.writeFile(path.join(cc.workpieceDir, "system.md"), "# sys\n");
    await fs.writeFile(
      path.join(cc.workpieceDir, ".git", MATERIALIZATION_SENTINEL),
      JSON.stringify({ missionId: cc.missionId }) + "\n",
    );

    const step = await stepByName("git-init-commit");
    await step.run(cc);

    await expect(
      fs.stat(path.join(cc.workpieceDir, ".git", MATERIALIZATION_SENTINEL)),
    ).rejects.toThrow();
    expect(git(cc.workpieceDir, "log --oneline -1")).toContain("materialize from pin 1.0.0");
    await expect(
      fs.stat(path.join(cc.workpieceDir, ".git", "hooks", "pre-commit")),
    ).resolves.toBeTruthy();
  });

  test("git-init-commit is idempotent — re-run after crash skips commit, still clears sentinel", async () => {
    const cc = makeCtx({});
    await fs.mkdir(cc.workpieceDir, { recursive: true });
    git(cc.workpieceDir, "init");
    git(cc.workpieceDir, 'config user.email "test@example.com"');
    git(cc.workpieceDir, 'config user.name "Test"');
    await fs.writeFile(path.join(cc.workpieceDir, "system.md"), "# sys\n");

    const step = await stepByName("git-init-commit");
    await step.run(cc);
    const commitsAfterFirst = git(cc.workpieceDir, "rev-list --count HEAD");

    // Simulate a crash between baseline commit and sentinel deletion:
    // sentinel reappears, nothing new to stage.
    await fs.writeFile(
      path.join(cc.workpieceDir, ".git", MATERIALIZATION_SENTINEL),
      JSON.stringify({ missionId: cc.missionId }) + "\n",
    );
    await step.run(cc);

    expect(git(cc.workpieceDir, "rev-list --count HEAD")).toBe(commitsAfterFirst);
    await expect(
      fs.stat(path.join(cc.workpieceDir, ".git", MATERIALIZATION_SENTINEL)),
    ).rejects.toThrow();
  });
});
