/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0655: unit tests for release.state.validate — tests all five consistency
    checks with pass/fail scenarios plus edge cases.
  </purpose>
  <keywords>RFC-0655, release.state.validate, consistency, validator</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0655: initial release.state.validate tests covering all five checks and edge cases.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

// Mock readMissionManifest to bypass Zod schema validation
const mockManifests = vi.hoisted(() => ({
  manifests: new Map<string, Record<string, unknown>>(),
}));

const mockWorkspace = vi.hoisted(() => ({ value: "" as string }));

vi.mock("../mission/mission-io.ts", () => ({
  readMissionManifest: vi.fn(async (_workspaceRoot: string, missionId: string) => {
    const m = mockManifests.manifests.get(missionId);
    if (!m) throw new Error(`mission '${missionId}' not found`);
    return m;
  }),
  writeMissionManifest: vi.fn(),
  resolveMissionDir: vi.fn((workspaceRoot: string, missionId: string) =>
    join(workspaceRoot, "missions", missionId),
  ),
}));

// Mock registry-io — provide system state for release commands
vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sternsystem/registry-io.ts")>();
  return {
    ...actual,
    resolveCacheClonePath: vi.fn((workspaceRoot: string, systemId: string) =>
      join(workspaceRoot, "systems-cache", systemId),
    ),
    readSystemState: vi.fn(async (_workspaceRoot: string, _systemId: string) => ({
      schemaVersion: "system-state/v1",
      systemId: "test-sys",
      lastRelease: "test-sys-r000001",
    })),
    writeSystemState: vi.fn(),
  };
});

import { runReleaseStateValidate } from "../release/release-commands.ts";
import type { ReleaseStateCheck } from "../release/release-commands.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rsv-test-"));
  mockWorkspace.value = dir;
  return dir;
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
  } as unknown as KernelRuntimeContext;
}

function makeInput(flags: Record<string, string>): KernelCommandInput {
  return { flags, argv: [] } as unknown as KernelCommandInput;
}

function setMissionManifest(missionId: string, manifest: Record<string, unknown>): void {
  mockManifests.manifests.set(missionId, manifest);
}

async function writeReleaseManifest(
  workspaceRoot: string,
  releaseId: string,
  overrides: Record<string, unknown>,
): Promise<void> {
  const releaseDir = join(workspaceRoot, "releases", releaseId);
  await mkdir(releaseDir, { recursive: true });
  const defaults: Record<string, unknown> = {
    schemaVersion: "1.0.0",
    releaseId,
    systemId: "test-sys",
    missionId: "test-sys-m000001",
    semver: "0.1.0",
    platformVersion: "1.0.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    readyAt: null,
    state: "ready",
    commitSha: "0000000",
    platformSemanticHash: "sha256:semantic",
    siteContentHash: "sha256:content",
    distTreeHash: "sha256:abc123def456",
    distArtifactHash: null,
    artifact: null,
    behaviorSnapshotHash: "sha256:behavior",
    readableSnapshotHash: "sha256:readable",
    qualityReportHash: null,
    snapshotDiffVerdict: "pass",
    migratorVerdict: "pass",
    versionCompareVerdict: "in-sync",
    bootSmokeVerdict: "pass",
  };
  const merged = { ...defaults, ...overrides };
  await writeFile(join(releaseDir, "release.yaml"), stringifyYaml(merged));
}

async function writeCloseReport(
  workspaceRoot: string,
  missionId: string,
  report: Record<string, unknown>,
): Promise<void> {
  const evidenceDir = join(workspaceRoot, "missions", missionId, "evidence");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "close-report.json"), JSON.stringify(report, null, 2));
}

async function writeBordbuch(
  workspaceRoot: string,
  systemId: string,
  entries: Array<Record<string, unknown>>,
): Promise<void> {
  const bordbuchDir = join(workspaceRoot, "systems-cache", systemId, "bordbuch");
  await mkdir(bordbuchDir, { recursive: true });
  const fullEntries = entries.map((e, i) => ({
    schemaVersion: "1.0.0",
    actor: "agent",
    summary: e.kind === "mission-close" ? "Mission closed" : "Mission opened",
    previousHash: i > 0 ? entries[i - 1]!.hash : null,
    ...e,
  }));
  const lines = fullEntries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await writeFile(join(bordbuchDir, "events.ndjson"), lines);
}

function findCheck(
  checks: ReleaseStateCheck[] | undefined,
  rule: string,
): ReleaseStateCheck | undefined {
  return checks?.find((c) => c.rule === rule);
}

function getChecks(result: { data?: { checks?: ReleaseStateCheck[] } }): ReleaseStateCheck[] {
  return result.data?.checks ?? [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("release.state.validate", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await makeTempWorkspace();
    mockManifests.manifests.clear();
  });

  afterEach(async () => {
    await cleanup(workspaceRoot);
  });

  describe("flag resolution", () => {
    it("throws if no flag is provided", async () => {
      await expect(
        runReleaseStateValidate(makeInput({}), makeContext(workspaceRoot)),
      ).rejects.toThrow("at least one of --mission, --release, or --site is required");
    });
  });

  describe("check 1: mission-yaml-release-id-exists", () => {
    it("passes when release directory exists", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r000001",
        state: "closed",
      });
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "mission-yaml-release-id-exists");
      expect(check?.status).toBe("pass");
    });

    it("fails when release directory does not exist", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r999999",
        state: "closed",
      });

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "mission-yaml-release-id-exists");
      expect(check?.status).toBe("fail");
    });

    it("passes when mission has no releaseId", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: null,
        state: "closed",
      });

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "mission-yaml-release-id-exists");
      expect(check?.status).toBe("pass");
    });
  });

  describe("check 2: close-report-release-id-consistent", () => {
    it("passes when close-report releaseId matches mission.yaml", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r000001",
        state: "closed",
      });
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });
      await writeCloseReport(workspaceRoot, "test-sys-m000001", {
        releaseId: "test-sys-r000001",
      });

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "close-report-release-id-consistent");
      expect(check?.status).toBe("pass");
    });

    it("fails when close-report releaseId does not match", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r000001",
        state: "closed",
      });
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });
      await writeCloseReport(workspaceRoot, "test-sys-m000001", {
        releaseId: "test-sys-r000002",
      });

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "close-report-release-id-consistent");
      expect(check?.status).toBe("fail");
    });

    it("warns when close-report.json does not exist", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r000001",
        state: "closed",
      });
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "close-report-release-id-consistent");
      expect(check?.status).toBe("warn");
      expect(check?.message).toContain("close-report.json not found");
    });
  });

  describe("check 3: release-state-progressed", () => {
    it("passes when release is ready", async () => {
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });

      const result = await runReleaseStateValidate(
        makeInput({ release: "test-sys-r000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "release-state-progressed");
      expect(check?.status).toBe("pass");
    });

    it("warns when release is in prepared state (orphaned)", async () => {
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "prepared",
      });

      const result = await runReleaseStateValidate(
        makeInput({ release: "test-sys-r000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "release-state-progressed");
      expect(check?.status).toBe("warn");
      expect(check?.message).toContain("prepared");
    });

    it("fails when release does not exist (via --mission)", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r999999",
        state: "closed",
      });

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "release-state-progressed");
      expect(check?.status).toBe("fail");
    });
  });

  describe("check 4: bordbuch-release-id-consistent", () => {
    it("passes when bordbuch releaseId matches mission.yaml", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r000001",
        state: "closed",
      });
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });
      await writeBordbuch(workspaceRoot, "test-sys", [
        {
          id: "event-000001",
          systemId: "test-sys",
          occurredAt: "2026-08-01T10:00:00.000Z",
          kind: "mission-open",
          status: "done",
          missionId: "test-sys-m000001",
          releaseId: null,
          hash: "sha256:abc",
        },
        {
          id: "event-000002",
          systemId: "test-sys",
          occurredAt: "2026-08-01T11:00:00.000Z",
          kind: "mission-close",
          status: "done",
          missionId: "test-sys-m000001",
          releaseId: "test-sys-r000001",
          hash: "sha256:def",
        },
      ]);

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "bordbuch-release-id-consistent");
      expect(check?.status).toBe("pass");
    });

    it("passes when bordbuch releaseId is null (close before release.prepare)", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r000001",
        state: "closed",
      });
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });
      await writeBordbuch(workspaceRoot, "test-sys", [
        {
          id: "event-000001",
          systemId: "test-sys",
          occurredAt: "2026-08-01T10:00:00.000Z",
          kind: "mission-open",
          status: "done",
          missionId: "test-sys-m000001",
          releaseId: null,
          hash: "sha256:abc",
        },
        {
          id: "event-000002",
          systemId: "test-sys",
          occurredAt: "2026-08-01T11:00:00.000Z",
          kind: "mission-close",
          status: "done",
          missionId: "test-sys-m000001",
          releaseId: null,
          hash: "sha256:def",
        },
      ]);

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "bordbuch-release-id-consistent");
      expect(check?.status).toBe("pass");
      expect(check?.message).toContain("null");
    });

    it("fails when bordbuch releaseId does not match mission.yaml", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r000001",
        state: "closed",
      });
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });
      await writeBordbuch(workspaceRoot, "test-sys", [
        {
          id: "event-000001",
          systemId: "test-sys",
          occurredAt: "2026-08-01T10:00:00.000Z",
          kind: "mission-open",
          status: "done",
          missionId: "test-sys-m000001",
          releaseId: null,
          hash: "sha256:abc",
        },
        {
          id: "event-000002",
          systemId: "test-sys",
          occurredAt: "2026-08-01T11:00:00.000Z",
          kind: "mission-close",
          status: "done",
          missionId: "test-sys-m000001",
          releaseId: "test-sys-r000002",
          hash: "sha256:def",
        },
      ]);

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "bordbuch-release-id-consistent");
      expect(check?.status).toBe("fail");
    });

    it("uses latest mission-close entry (re-opened mission)", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r000001",
        state: "closed",
      });
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });
      await writeBordbuch(workspaceRoot, "test-sys", [
        {
          id: "event-000001",
          systemId: "test-sys",
          occurredAt: "2026-08-01T10:00:00.000Z",
          kind: "mission-open",
          status: "done",
          missionId: "test-sys-m000001",
          releaseId: null,
          hash: "sha256:abc",
        },
        {
          id: "event-000002",
          systemId: "test-sys",
          occurredAt: "2026-08-01T11:00:00.000Z",
          kind: "mission-close",
          status: "done",
          missionId: "test-sys-m000001",
          releaseId: "test-sys-r000002",
          hash: "sha256:def",
        },
        {
          id: "event-000003",
          systemId: "test-sys",
          occurredAt: "2026-08-01T12:00:00.000Z",
          kind: "mission-open",
          status: "done",
          missionId: "test-sys-m000001",
          releaseId: null,
          hash: "sha256:ghi",
        },
        {
          id: "event-000004",
          systemId: "test-sys",
          occurredAt: "2026-08-01T13:00:00.000Z",
          kind: "mission-close",
          status: "done",
          missionId: "test-sys-m000001",
          releaseId: "test-sys-r000001",
          hash: "sha256:jkl",
        },
      ]);

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "bordbuch-release-id-consistent");
      expect(check?.status).toBe("pass");
    });
  });

  describe("check 5: state-last-release-consistent", () => {
    it("passes when registry lastRelease matches ready release", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r000001",
        state: "closed",
      });
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "state-last-release-consistent");
      expect(check?.status).toBe("pass");
    });

    it("warns when registry lastRelease does not match", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r000002",
        state: "closed",
      });
      await writeReleaseManifest(workspaceRoot, "test-sys-r000002", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "state-last-release-consistent");
      expect(check?.status).toBe("warn");
    });
  });

  describe("edge case: missing close-report.json (pre-RFC-0477 mission)", () => {
    it("warns instead of failing", async () => {
      setMissionManifest("test-sys-m000001", {
        systemId: "test-sys",
        releaseId: "test-sys-r000001",
        state: "closed",
      });
      await writeReleaseManifest(workspaceRoot, "test-sys-r000001", {
        systemId: "test-sys",
        missionId: "test-sys-m000001",
        state: "ready",
      });

      const result = await runReleaseStateValidate(
        makeInput({ mission: "test-sys-m000001" }),
        makeContext(workspaceRoot),
      );

      const check = findCheck(getChecks(result), "close-report-release-id-consistent");
      expect(check?.status).toBe("warn");
    });
  });
});
