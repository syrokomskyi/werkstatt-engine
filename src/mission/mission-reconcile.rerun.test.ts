/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1327 AC-4: mission.reconcile run-twice test — a second reconcile on an
    already-reconciled workpiece head exits 0 as a no-op (alreadyReconciled),
    leaves the cache-clone tree untouched, and generated files untracked by the
    RFC-0913 pass do not resurface as dirty state after the run.
  </purpose>
<non-goals>
  <item>Not a merge-semantics test — divergence/conflict behaviour lives in the RFC-0918/0568 suites.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1327: initial rerun test — full clone+workpiece fixture, generated-file untracking, second-run convergence via expectRerunSafe.</item>
  <item>RFC-1327: run-twice idempotency — declarations, command.idempotency.validate, rerun tests, reconcile/ship/abort convergence fixes</item>
  <item>RFC-1327: explicit test timeouts on rerun tests — root vitest testTimeout is 5s</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { expectRerunSafe, snapshotGitTree } from "../testing/run-twice.ts";

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(async () => ({
      exitCode: 0,
      data: { systemId: "test-system", syncedAt: "2026-10-17T00:00:00.000Z" },
      summary: "ok",
    })),
  };
});

function gitInit(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let testRoot: string;
let tmpWorkspace: string;
let cacheDir: string;
let workpieceDir: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rerun-reconcile-"));
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
  writeFileSync(join(cacheDir, "README.md"), "# system\n");
  gitCommit(cacheDir, "initial system");
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "");
  gitCommit(cacheDir, "add bordbuch");

  const bareDir = join(testRoot, "systems-cache", "test-system.git");
  execSync(`git clone --bare ${JSON.stringify(cacheDir)} ${JSON.stringify(bareDir)}`, {
    stdio: "pipe",
  });
  execSync(`git remote add origin ${JSON.stringify(bareDir)}`, { cwd: cacheDir, stdio: "pipe" });

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
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
        migratedAt: null,
        reconciledAt: null,
        releaseId: null,
        rfcId: null,
        operationId: "op-001",
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(missionDir, "evidence", "validation-report.json"),
    JSON.stringify({
      contractFull: { passed: true },
      timestamp: "2026-10-17T01:30:00.000Z",
    }) + "\n",
  );

  workpieceDir = join(missionDir, "workpiece");
  execSync(`git clone ${JSON.stringify(cacheDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });
  mkdirSync(join(workpieceDir, "src", "content"), { recursive: true });
  writeFileSync(join(workpieceDir, "src", "content", "system.md"), "---\nid: test\n---\n# Test\n");
  // A generated artifact the RFC-0913 untrack pass must strip from tracking.
  writeFileSync(join(workpieceDir, "src", "surface.generated.yaml"), "generated: true\n");
  gitCommit(workpieceDir, "workpiece change");

  gitCommit(tmpWorkspace, "add mission");
}

test("mission.reconcile second run is a no-op on the same workpiece head (RFC-1327)", { timeout: 60_000 }, async () => {
  setup();
  const { runMissionReconcile } = await import("./mission-materialization-commands.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  const { first, second, snapshot } = await expectRerunSafe({
    run: async () => {
      const r = await runMissionReconcile(input, context);
      return { exitCode: r.exitCode, status: r.exitCode === 0 ? "ok" : "failed" };
    },
    snapshot: () => `${snapshotGitTree(cacheDir)}\n${snapshotGitTree(workpieceDir)}`,
  });

  expect(first.exitCode).toBe(0);
  expect(second.exitCode).toBe(0);

  // The untracked generated file must not linger on disk — the rewind on a
  // subsequent run would un-ignore it and the dirty guard would fire.
  expect(
    existsSync(join(cacheDir, "src", "surface.generated.yaml")),
    "generated file must be deleted from the clone working tree after untracking",
  ).toBe(false);

  expect(snapshot).not.toContain("surface.generated.yaml");
});
