import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolveMissionManifestPath,
  readMissionManifest,
  writeMissionManifest,
  missionExists,
  createMissionDirectories,
  resolveMissionEvidenceDir,
  listMissionDirs,
} from "../mission-io.ts";
import type { MissionManifest } from "@warpgogol/werkstatt-engine/schemas";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(process.cwd(), "tmp-mission-io-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveMissionManifestPath", () => {
  test("joins workspaceRoot with missions/<id>/mission.yaml", () => {
    const p = resolveMissionManifestPath("/tmp/ws", "m000001");
    expect(p).toBe(join("/tmp/ws", "missions", "m000001", "mission.yaml"));
  });
});

describe("missionExists", () => {
  test("returns false when manifest does not exist", async () => {
    expect(await missionExists(tmpDir, "test-system-m000001")).toBe(false);
  });

  test("returns true when manifest exists", async () => {
    const dir = join(tmpDir, "missions", "test-system-m000001");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mission.yaml"), "missionId: test-system-m000001\n");
    expect(await missionExists(tmpDir, "test-system-m000001")).toBe(true);
  });
});

describe("writeMissionManifest & readMissionManifest", () => {
  test("round-trip write and read", async () => {
    const manifest: MissionManifest = {
      schemaVersion: "1.0.0",
      missionId: "test-system-m000001",
      systemId: "test-system",
      state: "open",
      brief: "Test mission",
      openedAt: "2026-01-01T00:00:00Z",
      openedBy: "agent",
      closedAt: null,
      closedBy: null,
      pinAtOpen: "abc123",
      materializedAt: null,
      reconciledAt: null,
      migratedAt: null,
      releaseId: null,
      rfcId: null,
      operationId: "op-001",
    };
    await writeMissionManifest(tmpDir, manifest);
    const read = await readMissionManifest(tmpDir, "test-system-m000001");
    expect(read.missionId).toBe("test-system-m000001");
    expect(read.systemId).toBe("test-system");
    expect(read.state).toBe("open");
    expect(read.brief).toBe("Test mission");
  });
});

describe("createMissionDirectories", () => {
  test("creates workpiece and evidence directories", async () => {
    await createMissionDirectories(tmpDir, "test-system-m000001");
    expect(existsSync(join(tmpDir, "missions", "test-system-m000001", "workpiece"))).toBe(true);
    expect(existsSync(join(tmpDir, "missions", "test-system-m000001", "evidence"))).toBe(true);
  });
});

describe("resolveMissionEvidenceDir", () => {
  test("resolves to evidence/axiom subdirectory", () => {
    const dir = resolveMissionEvidenceDir(tmpDir, "test-system-m000001");
    expect(dir).toBe(join(tmpDir, "missions", "test-system-m000001", "evidence", "axiom"));
  });
});

describe("listMissionDirs", () => {
  test("returns empty array when missions dir does not exist", async () => {
    expect(await listMissionDirs(tmpDir)).toEqual([]);
  });

  test("lists mission directories", async () => {
    mkdirSync(join(tmpDir, "missions", "sys-a-m000001"), { recursive: true });
    mkdirSync(join(tmpDir, "missions", "sys-b-m000002"), { recursive: true });
    const dirs = await listMissionDirs(tmpDir);
    expect(dirs).toContain("sys-a-m000001");
    expect(dirs).toContain("sys-b-m000002");
  });

  test("excludes archive directory", async () => {
    mkdirSync(join(tmpDir, "missions", "archive"), { recursive: true });
    mkdirSync(join(tmpDir, "missions", "sys-a-m000001"), { recursive: true });
    const dirs = await listMissionDirs(tmpDir);
    expect(dirs).not.toContain("archive");
  });

  test("filters by systemId", async () => {
    mkdirSync(join(tmpDir, "missions", "sys-a-m000001"), { recursive: true });
    mkdirSync(join(tmpDir, "missions", "sys-b-m000002"), { recursive: true });
    const dirs = await listMissionDirs(tmpDir, "sys-a");
    expect(dirs).toContain("sys-a-m000001");
    expect(dirs).not.toContain("sys-b-m000002");
  });
});
