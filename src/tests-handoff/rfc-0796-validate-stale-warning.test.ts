/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for rfc 0796 validate stale warning covering RFC-0796: validateNoStaleMissionEntries.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0796: initial tests for stale entry warnings in mission.validate.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
</CHANGE_SUMMARY>
*/

import { test, describe, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-stale-validate-0796-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeMissionManifest(workspaceRoot: string, missionId: string, state: string): void {
  const missionDir = join(workspaceRoot, "missions", missionId);
  mkdirSync(missionDir, { recursive: true });
  writeFileSync(
    join(missionDir, "mission.yaml"),
    `schemaVersion: "1.0.0"\nmissionId: ${missionId}\nsystemId: test-system\nstate: ${state}\n`,
  );
}

describe("RFC-0796: validateNoStaleMissionEntries", () => {
  test("stale symlink in missions/ root produces warning", async () => {
    const { validateNoStaleMissionEntries } =
      await import("../mission/mission-materialization-commands.ts");
    const missionsDir = join(tmpDir, "missions");
    mkdirSync(missionsDir, { recursive: true });
    const targetDir = join(missionsDir, "archived-mission");
    mkdirSync(targetDir, { recursive: true });
    symlinkSync(targetDir, join(missionsDir, "test-system-m000001"));

    const warnings = await validateNoStaleMissionEntries(tmpDir);

    expect(warnings.length).toBe(1);
    expect(warnings[0].kind).toBe("symlink");
    expect(warnings[0].path).toBe("missions/test-system-m000001");
  });

  test("terminal-state directory in missions/ root produces warning", async () => {
    const { validateNoStaleMissionEntries } =
      await import("../mission/mission-materialization-commands.ts");
    writeMissionManifest(tmpDir, "test-system-m000001", "closed");

    const warnings = await validateNoStaleMissionEntries(tmpDir);

    expect(warnings.length).toBe(1);
    expect(warnings[0].kind).toBe("terminal-state-in-root");
    expect(warnings[0].state).toBe("closed");
  });

  test("open mission in missions/ root produces no warning", async () => {
    const { validateNoStaleMissionEntries } =
      await import("../mission/mission-materialization-commands.ts");
    writeMissionManifest(tmpDir, "test-system-m000001", "open");

    const warnings = await validateNoStaleMissionEntries(tmpDir);

    expect(warnings.length).toBe(0);
  });

  test("archive/ directory produces no warning (excluded)", async () => {
    const { validateNoStaleMissionEntries } =
      await import("../mission/mission-materialization-commands.ts");
    const archiveDir = join(tmpDir, "missions", "archive");
    mkdirSync(archiveDir, { recursive: true });
    mkdirSync(join(archiveDir, "closed"), { recursive: true });

    const warnings = await validateNoStaleMissionEntries(tmpDir);

    expect(warnings.length).toBe(0);
  });

  test("no missions/ directory returns empty warnings", async () => {
    const { validateNoStaleMissionEntries } =
      await import("../mission/mission-materialization-commands.ts");

    const warnings = await validateNoStaleMissionEntries(tmpDir);

    expect(warnings.length).toBe(0);
  });
});
