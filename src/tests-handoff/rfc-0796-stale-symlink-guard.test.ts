/*
<MODULE_CONTRACT>
  <purpose>RFC-0796: unit tests for stale symlink and archive/ filtering in deriveNextMissionNumberSafe and mission.cleanup --older-than.</purpose>
  <keywords>RFC-0796, stale symlink, archive, deriveNextMissionNumberSafe, mission.cleanup</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0796: initial tests for stale symlink guards in mission number derivation and cleanup.</item>
</CHANGE_SUMMARY>
*/

import { test, describe, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deriveNextMissionNumberSafe } from "../bordbuch/bordbuch-io.ts";
import { runMissionCleanup } from "../mission/mission-cleanup.ts";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-stale-symlink-0796-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeMissionManifest(
  workspaceRoot: string,
  missionId: string,
  state: string,
  closedAt: string | null,
): void {
  const missionDir = join(workspaceRoot, "missions", missionId);
  mkdirSync(missionDir, { recursive: true });
  const manifest: Record<string, unknown> = {
    schemaVersion: "1.0.0",
    missionId,
    systemId: "test-system",
    state,
    brief: "Test",
    openedAt: "2026-01-01T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: "2026-01-01T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: "2026-01-01T02:00:00.000Z",
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");
}

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: tmpDir,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
      debug: () => {},
    },
  } as unknown as KernelRuntimeContext;
}

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return { flags, argv: [] } as unknown as KernelCommandInput;
}

const EMPTY_ENTRIES: BordbuchEntry[] = [];

describe("RFC-0796: deriveNextMissionNumberSafe — stale symlink and archive guards", () => {
  test("ignores archive/ directory when scanning mission dirs", async () => {
    const missionsDir = join(tmpDir, "missions");
    mkdirSync(missionsDir, { recursive: true });
    // Create an archived mission with a high number
    const archiveDir = join(missionsDir, "archive", "closed", "test-system-m000050");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, "mission.yaml"),
      "missionId: test-system-m000050\nstate: closed\n",
    );

    const next = await deriveNextMissionNumberSafe(EMPTY_ENTRIES, tmpDir, "test-system");
    expect(next).toBe(1);
  });

  test("ignores symlinks when scanning mission dirs", async () => {
    const missionsDir = join(tmpDir, "missions");
    mkdirSync(missionsDir, { recursive: true });

    // Create a real archived mission
    const archiveTarget = join(missionsDir, "archive", "closed", "test-system-m000040");
    mkdirSync(archiveTarget, { recursive: true });
    writeFileSync(
      join(archiveTarget, "mission.yaml"),
      "missionId: test-system-m000040\nstate: closed\n",
    );

    // Create a stale symlink pointing to the archived mission
    const symlinkPath = join(missionsDir, "test-system-m000040");
    symlinkSync(archiveTarget, symlinkPath);

    const next = await deriveNextMissionNumberSafe(EMPTY_ENTRIES, tmpDir, "test-system");
    // Should NOT count the symlink — next number is 1, not 41
    expect(next).toBe(1);
  });

  test("counts real mission directories correctly", async () => {
    const missionsDir = join(tmpDir, "missions");
    mkdirSync(missionsDir, { recursive: true });

    // Create real mission dirs
    writeMissionManifest(tmpDir, "test-system-m000010", "open", null);
    writeMissionManifest(tmpDir, "test-system-m000020", "open", null);

    const next = await deriveNextMissionNumberSafe(EMPTY_ENTRIES, tmpDir, "test-system");
    expect(next).toBe(21);
  });

  test("bordbuch entries are still counted", async () => {
    const entries: BordbuchEntry[] = [
      { kind: "mission-open", missionId: "test-system-m000030" } as BordbuchEntry,
    ];
    const next = await deriveNextMissionNumberSafe(entries, tmpDir, "test-system");
    expect(next).toBe(31);
  });
});

describe("RFC-0796: mission.cleanup --older-than — stale symlink and archive guards", () => {
  test("ignores archive/ directory", async () => {
    const missionsDir = join(tmpDir, "missions");
    mkdirSync(missionsDir, { recursive: true });

    // Create an archived mission with workpiece
    const archiveMissionDir = join(missionsDir, "archive", "closed", "test-system-m000010");
    mkdirSync(archiveMissionDir, { recursive: true });
    writeFileSync(
      join(archiveMissionDir, "mission.yaml"),
      "missionId: test-system-m000010\nstate: closed\nclosedAt: 2020-01-01T00:00:00.000Z\n",
    );
    mkdirSync(join(archiveMissionDir, "workpiece"), { recursive: true });

    const result = await runMissionCleanup(makeInput({ "older-than": "1d" }), makeContext());

    // Archive dir should not be scanned — nothing removed
    expect(result.data?.removedPaths).toHaveLength(0);
    // The archived workpiece should still exist
    expect(existsSync(join(archiveMissionDir, "workpiece"))).toBe(true);
  });

  test("ignores symlinks to archived missions", async () => {
    const missionsDir = join(tmpDir, "missions");
    mkdirSync(missionsDir, { recursive: true });

    // Create an archived mission
    const archiveTarget = join(missionsDir, "archive", "closed", "test-system-m000010");
    mkdirSync(archiveTarget, { recursive: true });
    writeFileSync(
      join(archiveTarget, "mission.yaml"),
      "missionId: test-system-m000010\nstate: closed\nclosedAt: 2020-01-01T00:00:00.000Z\n",
    );
    mkdirSync(join(archiveTarget, "workpiece"), { recursive: true });

    // Create a stale symlink in missions/ root
    const symlinkPath = join(missionsDir, "test-system-m000010");
    symlinkSync(archiveTarget, symlinkPath);

    const result = await runMissionCleanup(makeInput({ "older-than": "1d" }), makeContext());

    // Symlink should not be followed — no removals
    expect(result.data?.removedPaths).toHaveLength(0);
    // The archived workpiece should still exist
    expect(existsSync(join(archiveTarget, "workpiece"))).toBe(true);
  });

  test("cleans up real closed missions older than threshold", async () => {
    const missionsDir = join(tmpDir, "missions");
    mkdirSync(missionsDir, { recursive: true });

    // Create a real closed mission with old closedAt
    writeMissionManifest(tmpDir, "test-system-m000010", "closed", "2020-01-01T00:00:00.000Z");
    mkdirSync(join(missionsDir, "test-system-m000010", "workpiece"), { recursive: true });

    const result = await runMissionCleanup(makeInput({ "older-than": "1d" }), makeContext());

    expect(result.data?.removedPaths).toContain("test-system-m000010/workpiece");
    expect(existsSync(join(missionsDir, "test-system-m000010", "workpiece"))).toBe(false);
  });
});
