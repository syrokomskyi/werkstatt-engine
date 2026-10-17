import { test, expect, describe, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1190 acceptance tests: mission context propagation through
    release-mode deployments — precedence chain, MISSION_CONTEXT_UNRESOLVED
    blocking, evidence-sync ship steps, and journal record fields.
  </purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the rfc suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

const executeKernelCommandMock = vi.fn<(opts: { commandName: string }) => Promise<unknown>>();

vi.mock("@warpgogol/werkstatt-engine/kernel", () => ({
  executeKernelCommand: (opts: { commandName: string }) => executeKernelCommandMock(opts),
  KERNEL_UNIVERSAL_FLAGS: [],
}));

const readSystemStateMock = vi.fn<() => Promise<Record<string, unknown>>>();
vi.mock("../../sternsystem/registry-io.ts", () => ({
  readSystemConfigSmart: vi.fn(async () => ({
    deployment: {
      adapter: "null",
      channels: {
        dev: { url: "https://dev.example" },
        alt: { url: "https://alt.example" },
        main: { url: "https://example.com" },
      },
    },
  })),
  readSystemStateSmart: vi.fn(async () => readSystemStateMock()),
  resolveCacheClonePath: vi.fn((root: string, id: string) => path.join(root, "systems-cache", id)),
  writeSystemStateSmart: vi.fn(async () => {}),
}));

vi.mock("../deploy-helpers.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../deploy-helpers.ts")>()),
  authorizeAndDeploy: vi.fn(async () => ({
    ok: true,
    outcome: { decisionId: "dec-1", ruleId: "ok", message: "ok" },
  })),
  buildEffectRecord: vi.fn(() => ({})),
  writeDeploymentEffectRecord: vi.fn(async () => {}),
  resolveArtifactHash: vi.fn(async () => ({ hash: "sha256:abc", source: "flag", path: undefined })),
  resolveGateDecisionPath: vi.fn(
    (_dir: string, _rel: string, _gate: string, flag?: string) => flag ?? "/tmp/gate.json",
  ),
}));

const executeDeployPhasesMock = vi.fn();
vi.mock("../deploy-execution.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../deploy-execution.ts")>()),
  executeDeployPhases: (ctx: unknown, channel: string) => executeDeployPhasesMock(ctx, channel),
}));

const { runLeitstandDevDeploy, resolveMissionContext } = await import("../leitstand-commands.ts");
const { buildShipPlan } = await import("../ship.ts");

function makeContext(workspaceRoot: string) {
  return {
    io: createDefaultIO().io,
    workspaceRoot,
    logger: {
      info: () => {},
      success: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  } as never;
}

function makeInput(flags: Record<string, unknown>) {
  return { flags, argv: [] } as never;
}

async function writeBuildIdentity(
  workspaceRoot: string,
  releaseId: string,
  identity: { missionId: string; commitSha: string },
): Promise<void> {
  const dir = path.join(workspaceRoot, "releases", releaseId, "dist", "client", ".well-known");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "build-identity.json"), JSON.stringify(identity));
}

describe("RFC-1190 resolveMissionContext — precedence chain", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc1190-"));
    readSystemStateMock.mockReset();
    readSystemStateMock.mockResolvedValue({});
    executeDeployPhasesMock.mockReset();
    executeKernelCommandMock.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("AC-2: no flag + null currentMission resolves from release build-identity.json", async () => {
    await writeBuildIdentity(tmpDir, "acme-r000001", {
      missionId: "acme-m000042",
      commitSha: "deadbeef",
    });

    const ctx = await resolveMissionContext(tmpDir, "acme", createDefaultIO().io, {
      releaseId: "acme-r000001",
    });

    expect(ctx).toEqual({
      missionId: "acme-m000042",
      commitSha: "deadbeef",
      source: "build-identity",
    });
  });

  test("explicit --mission wins over build-identity when they agree", async () => {
    await writeBuildIdentity(tmpDir, "acme-r000001", {
      missionId: "acme-m000042",
      commitSha: "deadbeef",
    });

    const ctx = await resolveMissionContext(tmpDir, "acme", createDefaultIO().io, {
      missionFlag: "acme-m000042",
      releaseId: "acme-r000001",
    });

    expect(ctx.source).toBe("flag");
    expect(ctx.missionId).toBe("acme-m000042");
    expect(ctx.commitSha).toBe("deadbeef");
  });

  test("explicit --mission contradicting build-identity throws MISSION_CONTEXT_MISMATCH", async () => {
    await writeBuildIdentity(tmpDir, "acme-r000001", {
      missionId: "acme-m000042",
      commitSha: "deadbeef",
    });

    await expect(
      resolveMissionContext(tmpDir, "acme", createDefaultIO().io, {
        missionFlag: "acme-m000099",
        releaseId: "acme-r000001",
      }),
    ).rejects.toThrow("MISSION_CONTEXT_MISMATCH");
  });

  test("falls back to system-state.currentMission when no flag and no build-identity", async () => {
    readSystemStateMock.mockResolvedValue({ currentMission: "acme-m000007" });

    const ctx = await resolveMissionContext(tmpDir, "acme", createDefaultIO().io, {
      releaseId: "acme-r000001",
    });

    expect(ctx.source).toBe("current-mission");
    expect(ctx.missionId).toBe("acme-m000007");
  });

  test("returns source 'none' when nothing resolves", async () => {
    const ctx = await resolveMissionContext(tmpDir, "acme", createDefaultIO().io, {
      releaseId: "acme-r000001",
    });
    expect(ctx).toEqual({ missionId: "", commitSha: "", source: "none" });
  });
});

describe("RFC-1190 leitstand.dev-deploy — unresolved mission context", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc1190-deploy-"));
    readSystemStateMock.mockReset();
    readSystemStateMock.mockResolvedValue({}); // currentMission: null
    executeDeployPhasesMock.mockReset();
    executeDeployPhasesMock.mockResolvedValue({
      deploymentUrl: "https://dev.example",
      failingPhase: undefined,
      buildSkipped: true,
      buildIdentity: { releaseId: "acme-r000001", written: false, path: "" },
      axiomStatus: "pass",
      axiomExitCode: 0,
      freshness: { verified: true, cdnDistTreeHash: "h", localDistTreeHash: "h", attempts: 1 },
      evidenceSynced: false,
      evidenceSyncError: null,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("AC-3: exits non-zero with MISSION_CONTEXT_UNRESOLVED when nothing resolves", async () => {
    const result = (await runLeitstandDevDeploy(
      makeInput({ site: "acme", release: "acme-r000001" }),
      makeContext(tmpDir),
    )) as { exitCode: number; diagnostics?: Array<{ ruleId: string }>; summary: string };

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics?.[0]?.ruleId).toBe("MISSION_CONTEXT_UNRESOLVED");
    expect(result.summary).toContain("MISSION_CONTEXT_UNRESOLVED");
    // The deploy pipeline must NOT have been reached
    expect(executeDeployPhasesMock).not.toHaveBeenCalled();
  });

  test("AC-3: --skip-evidence-sync is the explicit escape hatch — deploy proceeds", async () => {
    const result = (await runLeitstandDevDeploy(
      makeInput({ site: "acme", release: "acme-r000001", "skip-evidence-sync": true }),
      makeContext(tmpDir),
    )) as { exitCode: number };

    expect(result.exitCode).toBe(0);
    expect(executeDeployPhasesMock).toHaveBeenCalledOnce();
    const ctxArg = executeDeployPhasesMock.mock.calls[0]![0] as {
      skipEvidenceSync: boolean;
      missionId?: string;
    };
    expect(ctxArg.skipEvidenceSync).toBe(true);
    expect(ctxArg.missionId).toBe("");
  });

  test("resolved context flows into executeDeployPhases (missionId + commitSha + record)", async () => {
    await writeBuildIdentity(tmpDir, "acme-r000001", {
      missionId: "acme-m000042",
      commitSha: "cafebabe",
    });

    const result = (await runLeitstandDevDeploy(
      makeInput({ site: "acme", release: "acme-r000001" }),
      makeContext(tmpDir),
    )) as { exitCode: number; data: { missionId: string; axiom: { status: string } } };

    expect(result.exitCode).toBe(0);
    const ctxArg = executeDeployPhasesMock.mock.calls[0]![0] as {
      missionId: string;
      commitSha: string;
      missionContext: { source: string };
    };
    expect(ctxArg.missionId).toBe("acme-m000042");
    expect(ctxArg.commitSha).toBe("cafebabe");
    expect(ctxArg.missionContext.source).toBe("build-identity");
    // AC-1: the step journal record (built from deploy result data) carries
    // missionId + a real axiom status — not "not-run".
    expect(result.data.missionId).toBe("acme-m000042");
    expect(result.data.axiom.status).toBe("pass");
  });
});

describe("RFC-1190 buildShipPlan — evidence-sync steps", () => {
  test("AC-5: evidence-sync-* step follows each certify-* step", () => {
    const plan = buildShipPlan({ until: "archived" });
    const names = plan.steps.map((s) => s.name);

    expect(names.indexOf("evidence-sync-dev")).toBe(names.indexOf("certify-dev") + 1);
    expect(names.indexOf("evidence-sync-alt")).toBe(names.indexOf("certify-alt") + 1);
    expect(names.indexOf("evidence-sync-main")).toBe(names.indexOf("certify-main") + 1);
  });

  test("AC-5: evidence-sync steps survive the closed-mission plan shape", () => {
    const plan = buildShipPlan({ until: "archived", missionClosed: true });
    const names = plan.steps.map((s) => s.name);

    expect(names).toContain("evidence-sync-dev");
    expect(names).toContain("evidence-sync-alt");
    expect(names).toContain("evidence-sync-main");
    expect(names).not.toContain("mission-validate");
    expect(names).not.toContain("mission-close");
  });

  test("evidence-sync step is a clean no-op when evidence/axiom is absent", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc1190-ship-"));
    executeKernelCommandMock.mockReset();
    try {
      const missionDir = path.join(tmpDir, "missions", "acme-m000042");
      await fs.mkdir(missionDir, { recursive: true });
      const plan = buildShipPlan({ until: "archived" });
      const step = plan.steps.find((s) => s.name === "evidence-sync-dev")!;
      const ctx = {
        workspaceRoot: tmpDir,
        systemId: "acme",
        missionId: "acme-m000042",
        missionDir,
        workpieceDir: path.join(missionDir, "workpiece"),
        cacheCloneDir: path.join(tmpDir, "systems-cache", "acme"),
        releaseId: "acme-r000001",
        missionClosed: false,
        logger: { info: () => {} },
        io: createDefaultIO().io,
      };

      const meta = (await step.run(ctx as never)) as { skipped: boolean; missionId: string };
      expect(meta.skipped).toBe(true);
      expect(meta.missionId).toBe("acme-m000042");
      expect(executeKernelCommandMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("AC-4: evidence.sync failure while evidence exists throws EVIDENCE_SYNC_FAILED", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc1190-ship-"));
    executeKernelCommandMock.mockReset();
    try {
      const evidenceDir = path.join(tmpDir, "missions", "acme-m000042", "evidence", "axiom");
      await fs.mkdir(evidenceDir, { recursive: true });
      await fs.writeFile(
        path.join(evidenceDir, "evidence-metadata.json"),
        JSON.stringify({ runTimestamp: "2026-10-04T00-00-00-000Z" }),
      );
      executeKernelCommandMock.mockResolvedValue({ exitCode: 1, summary: "R2 upload failed" });

      const plan = buildShipPlan({ until: "archived" });
      const step = plan.steps.find((s) => s.name === "evidence-sync-dev")!;
      const ctx = {
        workspaceRoot: tmpDir,
        systemId: "acme",
        missionId: "acme-m000042",
        missionDir: path.join(tmpDir, "missions", "acme-m000042"),
        workpieceDir: path.join(tmpDir, "missions", "acme-m000042", "workpiece"),
        cacheCloneDir: path.join(tmpDir, "systems-cache", "acme"),
        releaseId: "acme-r000001",
        missionClosed: false,
        logger: { info: () => {} },
        io: createDefaultIO().io,
      };

      await expect(step.run(ctx as never)).rejects.toThrow("EVIDENCE_SYNC_FAILED");
      // AC-5: invoked with --site and --mission
      const syncCall = executeKernelCommandMock.mock.calls.find(
        (c) => c[0].commandName === "evidence.sync",
      );
      expect(syncCall).toBeDefined();
      expect(syncCall![0]).toMatchObject({
        argv: expect.arrayContaining(["--site=acme", "--mission=acme-m000042"]),
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
