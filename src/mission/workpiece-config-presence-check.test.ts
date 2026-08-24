/*
<MODULE_CONTRACT>
  <purpose>RFC-0844: Unit tests for workpiece.config.presence.check command handler.</purpose>
  <keywords>RFC-0844, operator-config, presence-check, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0844: initial unit tests for runWorkpieceConfigPresenceCheck.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWorkpieceConfigPresenceCheck } from "./workpiece-config-presence-check.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "../kernel/types.ts";

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    argv: [],
    flags: flags as Record<string, boolean | string | string[]>,
  };
}

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  return { workspaceRoot } as unknown as KernelRuntimeContext;
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "rfc0844-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createWorkpiece(missionId: string): string {
  const workpieceDir = join(tempDir, "missions", missionId, "workpiece");
  mkdirSync(workpieceDir, { recursive: true });
  return workpieceDir;
}

test("missing .lighthouse-budget-ignore fails with correct restore command", async () => {
  const missionId = "test-system-m001";
  const workpieceDir = createWorkpiece(missionId);
  mkdirSync(join(workpieceDir, "src"), { recursive: true });
  writeFileSync(join(workpieceDir, "src", "image-delivery.config.yaml"), "test");

  const result = await runWorkpieceConfigPresenceCheck(
    makeInput({ mission: missionId }),
    makeContext(tempDir),
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.status).toBe("fail");
  expect(result.data!.missing).toHaveLength(1);
  expect(result.data!.missing[0].file).toBe(".lighthouse-budget-ignore");
  expect(result.data!.missing[0].restoreCommand).toBe(
    "cp ../systems-cache/test-system/.lighthouse-budget-ignore missions/test-system-m001/workpiece/.lighthouse-budget-ignore",
  );
  expect(result.data!.present).toEqual(["src/image-delivery.config.yaml"]);
});

test("missing src/image-delivery.config.yaml fails with mkdir -p in restore command", async () => {
  const missionId = "test-system-m002";
  const workpieceDir = createWorkpiece(missionId);
  mkdirSync(join(workpieceDir, "src"), { recursive: true });
  writeFileSync(join(workpieceDir, ".lighthouse-budget-ignore"), "test");

  const result = await runWorkpieceConfigPresenceCheck(
    makeInput({ mission: missionId }),
    makeContext(tempDir),
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.status).toBe("fail");
  expect(result.data!.missing).toHaveLength(1);
  expect(result.data!.missing[0].file).toBe("src/image-delivery.config.yaml");
  expect(result.data!.missing[0].restoreCommand).toContain("mkdir -p");
  expect(result.data!.missing[0].restoreCommand).toContain(
    "missions/test-system-m002/workpiece/src",
  );
  expect(result.data!.present).toEqual([".lighthouse-budget-ignore"]);
});

test("all files present passes", async () => {
  const missionId = "test-system-m003";
  const workpieceDir = createWorkpiece(missionId);
  mkdirSync(join(workpieceDir, "src"), { recursive: true });
  writeFileSync(join(workpieceDir, ".lighthouse-budget-ignore"), "test");
  writeFileSync(join(workpieceDir, "src", "image-delivery.config.yaml"), "test");

  const result = await runWorkpieceConfigPresenceCheck(
    makeInput({ mission: missionId }),
    makeContext(tempDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data!.status).toBe("pass");
  expect(result.data!.missing).toEqual([]);
  expect(result.data!.present).toHaveLength(2);
  expect(result.data!.present).toContain(".lighthouse-budget-ignore");
  expect(result.data!.present).toContain("src/image-delivery.config.yaml");
});

test("workpiece directory not found fails with clear error", async () => {
  const missionId = "nonexistent-m999";

  const result = await runWorkpieceConfigPresenceCheck(
    makeInput({ mission: missionId }),
    makeContext(tempDir),
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("Workpiece directory not found");
  expect(result.summary).toContain(missionId);
  expect(result.data!.missing).toEqual([]);
  expect(result.data!.present).toEqual([]);
});

test("both files missing fails with two entries", async () => {
  const missionId = "test-system-m004";
  createWorkpiece(missionId);

  const result = await runWorkpieceConfigPresenceCheck(
    makeInput({ mission: missionId }),
    makeContext(tempDir),
  );

  expect(result.exitCode).toBe(1);
  expect(result.data!.status).toBe("fail");
  expect(result.data!.missing).toHaveLength(2);
  expect(result.data!.missing.map((m) => m.file)).toContain(".lighthouse-budget-ignore");
  expect(result.data!.missing.map((m) => m.file)).toContain("src/image-delivery.config.yaml");
  expect(result.data!.present).toEqual([]);
});

test("throws if --mission is not provided", async () => {
  await expect(
    runWorkpieceConfigPresenceCheck(makeInput({}), makeContext(tempDir)),
  ).rejects.toThrow("[workpiece.config.presence.check] --mission is required");
});
