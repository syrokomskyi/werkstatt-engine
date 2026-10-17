/*
<MODULE_CONTRACT>
<purpose>
Unit tests for snapshot auto regen covering detectSnap01; bootstrapCommittedSnapshot (ADR-0096).
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the snapshot suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe, vi, beforeEach, afterEach } from "vitest";
import {
  detectSnap01,
  bootstrapCommittedSnapshot,
  SNAPSHOT_FILENAME,
} from "../snapshot-auto-regen.ts";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

const kernelMock = vi.hoisted(() => ({
  calls: [] as { commandName: string; argv?: string[] }[],
  commitResult: { ok: true, exitCode: 0, summary: "" } as Record<string, unknown>,
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(async (options: { commandName: string; argv?: string[] }) => {
      kernelMock.calls.push(options);
      if (options.commandName === "mission.git.commit") return kernelMock.commitResult;
      return { ok: true, exitCode: 0, summary: "", data: null };
    }),
  };
});

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function setupWorkpiece(snapshotted: boolean): { workspaceRoot: string; workpieceDir: string } {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "tmp-snap-bootstrap-"));
  const workpieceDir = join(workspaceRoot, "missions", "sys-m1", "workpiece");
  mkdirSync(workpieceDir, { recursive: true });
  gitInit(workpieceDir);
  if (snapshotted) {
    writeFileSync(join(workpieceDir, SNAPSHOT_FILENAME), "generated: true\n");
    execSync("git add -A", { cwd: workpieceDir, stdio: "pipe" });
    execSync('git commit -m "initial"', { cwd: workpieceDir, stdio: "pipe" });
  } else {
    writeFileSync(join(workpieceDir, "README.md"), "# x\n");
    execSync("git add -A", { cwd: workpieceDir, stdio: "pipe" });
    execSync('git commit -m "initial"', { cwd: workpieceDir, stdio: "pipe" });
  }
  return { workspaceRoot, workpieceDir };
}

const logger = { info: () => {} };
let tmpRoot: string | undefined;

beforeEach(() => {
  kernelMock.calls = [];
  kernelMock.commitResult = { ok: true, exitCode: 0, summary: "" };
});

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = undefined;
});

describe("detectSnap01", () => {
  test("returns false for undefined data", () => {
    expect(detectSnap01(undefined)).toBe(false);
  });

  test("returns false for null data", () => {
    expect(detectSnap01(null)).toBe(false);
  });

  test("returns false when diagnostics is missing", () => {
    expect(detectSnap01({})).toBe(false);
  });

  test("returns false when diagnostics is not an array", () => {
    expect(detectSnap01({ diagnostics: "not-array" })).toBe(false);
  });

  test("returns false when diagnostics is empty", () => {
    expect(detectSnap01({ diagnostics: [] })).toBe(false);
  });

  test("returns false when no SNAP-01 rule", () => {
    expect(detectSnap01({ diagnostics: [{ ruleId: "OTHER-01" }] })).toBe(false);
  });

  test("returns true when SNAP-01 is present", () => {
    expect(detectSnap01({ diagnostics: [{ ruleId: "SNAP-01" }] })).toBe(true);
  });

  test("returns true when SNAP-01 is among multiple diagnostics", () => {
    expect(detectSnap01({ diagnostics: [{ ruleId: "OTHER-01" }, { ruleId: "SNAP-01" }] })).toBe(
      true,
    );
  });
});

describe("bootstrapCommittedSnapshot (ADR-0096)", () => {
  test("returns alreadyCommitted when snapshot is tracked — no commands run", async () => {
    const { workspaceRoot } = setupWorkpiece(true);
    tmpRoot = workspaceRoot;

    const result = await bootstrapCommittedSnapshot({
      workspaceRoot,
      systemId: "sys",
      missionId: "sys-m1",
      logger,
    });

    expect(result.alreadyCommitted).toBe(true);
    expect(result.committed).toBe(false);
    expect(kernelMock.calls).toHaveLength(0);
  });

  test("closed workpiece — no commands run", async () => {
    const { workspaceRoot, workpieceDir } = setupWorkpiece(false);
    tmpRoot = workspaceRoot;
    writeFileSync(join(workpieceDir, ".closed"), "");

    const result = await bootstrapCommittedSnapshot({
      workspaceRoot,
      systemId: "sys",
      missionId: "sys-m1",
      logger,
    });

    expect(result.committed).toBe(false);
    expect(kernelMock.calls).toHaveLength(0);
  });

  test("missing committed snapshot — generate + scoped commit run", async () => {
    const { workspaceRoot } = setupWorkpiece(false);
    tmpRoot = workspaceRoot;

    const result = await bootstrapCommittedSnapshot({
      workspaceRoot,
      systemId: "sys",
      missionId: "sys-m1",
      logger,
    });

    expect(result.committed).toBe(true);
    const names = kernelMock.calls.map((c) => c.commandName);
    expect(names).toEqual(["behavior.snapshot.generate", "mission.git.commit"]);
    const commitCall = kernelMock.calls.find((c) => c.commandName === "mission.git.commit");
    expect(
      commitCall?.argv,
      "Bookkeeping commit must scope staging to the snapshot file only",
    ).toContain(`--scope-files=${SNAPSHOT_FILENAME}`);
  });

  test("commit failure — committed=false and error surfaced", async () => {
    const { workspaceRoot } = setupWorkpiece(false);
    tmpRoot = workspaceRoot;
    kernelMock.commitResult = { ok: false, exitCode: 1, summary: "pre-commit failed" };

    const result = await bootstrapCommittedSnapshot({
      workspaceRoot,
      systemId: "sys",
      missionId: "sys-m1",
      logger,
    });

    expect(result.committed).toBe(false);
    expect(result.error).toContain("pre-commit failed");
  });
});
