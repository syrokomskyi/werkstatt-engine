/*
<MODULE_CONTRACT>
  <purpose>RFC-1207: leitstand.certify candidate-preview tests — target resolution modes, fail-closed missing artifact, preview teardown, no real wrangler dev spawns.</purpose>
  <keywords>RFC-1207, leitstand, certify, candidate-preview, wrangler dev, measurement target, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1207: initial test suite for candidate-preview certification (AC-1..AC-5, AC-7).</item>
  <item>RFC-1207: candidate-preview certify — wrangler dev on releases/<id>/dist/server measures the candidate artifact</item>
  <item>RFC-1284: fix review REVIEW-CODE-2026-10-15-02: RFC-1284 — single-store marker, flag=false proceed, surfaced reconcile

F1: marker store unified on the git-tracked cache clone — access commands,
certify entry check, and deploy reconcile all use non-smart
readSystemState/writeSystemState (decisions Q-6); the mission-window
blindness and the DNA-106 false-resume are gone.
F2: --auto-manage-pin=false + suspension at entry skips entry-resume and
proceeds on the open channel (decisions Q-7) — RFC/AC-8 text amended.
F3: accessReconcile surfaced in data + summary of dev-deploy/propagate.
F4: CHANGE_SUMMARY items on all touched files.
F5: sternsystem.validate declares ACCESS-01/02 + system-state.yaml reads.
F6: isProtectedLiveTarget exported and covered (AC-12 probe repointed).
F7: fresh-read ordering proven — suspension opened mid-deploy suppresses
the re-assert.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { runLeitstandCertify } from "../leitstand/certify.ts";
import { provisionCandidatePreview } from "../leitstand/candidate-preview.ts";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  KernelRuntimeContext,
  KernelCommandInput,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(),
  };
});

vi.mock("../leitstand/candidate-preview.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../leitstand/candidate-preview.ts")>();
  return {
    ...actual,
    provisionCandidatePreview: vi.fn(),
  };
});

// Cache clone lives at <workspaceRoot>/../systems-cache in production — inside
// the per-test tmpdir here so gate-decision writes cannot leak across tests.
vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sternsystem/registry-io.ts")>();
  return {
    ...actual,
    resolveCacheClonePath: vi.fn((workspaceRoot: string, systemId: string) =>
      path.join(workspaceRoot, "systems-cache", systemId),
    ),
    // readSystemState resolves the cache-clone path internally (shared
    // ../systems-cache pool) — mock it so a stale sibling-pool state file
    // cannot inject a foreign systemState into the certify path.
    readSystemState: vi.fn(async (_workspaceRoot: string, systemId: string) => ({
      schemaVersion: "1.0.0",
      systemId,
      currentMission: null,
      lastRelease: null,
      lastPropagated: {},
      accessPin: null,
      passportRequired: false,
      ownershipRequired: false,
    })),
  };
});

const mockExecuteKernelCommand = executeKernelCommand as unknown as ReturnType<typeof vi.fn>;
const mockProvision = provisionCandidatePreview as unknown as ReturnType<typeof vi.fn>;

const ARTIFACT_HASH = `sha256:${"a".repeat(64)}`;
const SITE = "test-sys";
const RELEASE = "test-sys-r000001";
const PREVIEW_URL = "http://127.0.0.1:59999";

let tmpDir: string;
let warnMessages: string[];
let previewStop: ReturnType<typeof vi.fn>;

const context = {
  io: createDefaultIO().io,
  workspaceRoot: "/tmp/unused",
  logger: {
    info: () => {},
    success: () => {},
    warn: (m: string) => warnMessages.push(m),
    error: () => {},
    debug: () => {},
  },
} as unknown as KernelRuntimeContext;

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  return { flags, argv: [] };
}

function baseFlags(extra: Record<string, KernelFlagValue> = {}): Record<string, KernelFlagValue> {
  return {
    site: SITE,
    gate: "dev",
    release: RELEASE,
    "artifact-hash": ARTIFACT_HASH,
    ...extra,
  };
}

beforeEach(async () => {
  mockExecuteKernelCommand.mockReset();
  mockProvision.mockReset();
  warnMessages = [];

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "certify-1207-"));
  await fs.mkdir(path.join(tmpDir, "systems-cache", SITE), { recursive: true });
  (context as unknown as { workspaceRoot: string }).workspaceRoot = tmpDir;

  previewStop = vi.fn().mockResolvedValue(undefined);
  mockProvision.mockResolvedValue({
    baseUrl: PREVIEW_URL,
    port: 59999,
    releaseId: RELEASE,
    artifactHash: ARTIFACT_HASH,
    serverDir: path.join(tmpDir, "releases", RELEASE, "dist", "server"),
    startedAt: new Date().toISOString(),
    stop: previewStop,
  });

  // mission.check producer — pass by default.
  mockExecuteKernelCommand.mockResolvedValue({ ok: true, exitCode: 0, data: {}, summary: "ok" });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function makeReleaseWithServerDir(): Promise<void> {
  await fs.mkdir(path.join(tmpDir, "releases", RELEASE, "dist", "server"), {
    recursive: true,
  });
}

test("AC-1: default ship-managed certify provisions a candidate preview and crawls it", async () => {
  await makeReleaseWithServerDir();

  const result = await runLeitstandCertify(makeInput(baseFlags()), context);

  expect(mockProvision).toHaveBeenCalledTimes(1);
  expect(mockProvision).toHaveBeenCalledWith(
    expect.objectContaining({
      serverDir: path.join(tmpDir, "releases", RELEASE, "dist", "server"),
      releaseId: RELEASE,
      artifactHash: ARTIFACT_HASH,
    }),
  );
  const missionCheckCalls = mockExecuteKernelCommand.mock.calls.filter(
    (c) => (c[0] as { commandName: string }).commandName === "mission.check",
  );
  expect(missionCheckCalls.length).toBe(1);
  const argv = (missionCheckCalls[0][0] as { argv: string[] }).argv;
  expect(argv).toContain(`--base-url=${PREVIEW_URL}`);
  expect(argv).toContain("--external-preview");
  expect(result.exitCode).not.toBe(2);
});

test("AC-2: decision JSON reports the candidate release and candidate-preview target", async () => {
  await makeReleaseWithServerDir();

  const result = await runLeitstandCertify(makeInput(baseFlags()), context);

  expect(result.data?.measurementTarget).toBe("candidate-preview");
  expect(result.data?.measuredReleaseId).toBe(RELEASE);
  expect(result.data?.preview?.artifactHash).toBe(ARTIFACT_HASH);
  expect(result.data?.preview?.baseUrl).toBe(PREVIEW_URL);

  // AC-2 covers the persisted gate-decision record, not only the command result.
  const decisionRaw = await fs.readFile(
    path.join(tmpDir, "systems-cache", SITE, "gate-decisions", `${RELEASE}-dev.json`),
    "utf-8",
  );
  const decision = JSON.parse(decisionRaw) as {
    measurementTarget?: string;
    measuredReleaseId?: string;
  };
  expect(decision.measurementTarget).toBe("candidate-preview");
  expect(decision.measuredReleaseId).toBe(RELEASE);
});

test("AC-3: explicit --base-url is used verbatim and never spawns a preview", async () => {
  // Deliberately no dist/server — explicit mode must not require the artifact.
  const explicitUrl = "http://127.0.0.1:8788";

  const result = await runLeitstandCertify(
    makeInput(baseFlags({ "base-url": explicitUrl })),
    context,
  );

  expect(mockProvision).not.toHaveBeenCalled();
  expect(result.data?.measurementTarget).toBe("explicit");
  expect(result.data?.measuredReleaseId).toBeUndefined();
  const missionCheckCalls = mockExecuteKernelCommand.mock.calls.filter(
    (c) => (c[0] as { commandName: string }).commandName === "mission.check",
  );
  expect(missionCheckCalls.length).toBe(1);
  const argv = (missionCheckCalls[0][0] as { argv: string[] }).argv;
  expect(argv).toContain(`--base-url=${explicitUrl}`);
});

test("AC-4: --target channel measures the latest succeeded dev record and warns on mismatch", async () => {
  // Deliberately no dist/server — channel mode must not require the artifact.
  const opsDir = path.join(tmpDir, "systems-cache", SITE, "deployment-operations");
  await fs.mkdir(opsDir, { recursive: true });
  await fs.writeFile(
    path.join(opsDir, "op-1.json"),
    JSON.stringify({
      channel: "dev",
      state: "succeeded",
      deploymentUrl: "https://dev.example.com",
      releaseId: "test-sys-r000000",
      timestamp: "2026-10-05T00:00:00.000Z",
    }),
  );

  const result = await runLeitstandCertify(makeInput(baseFlags({ target: "channel" })), context);

  expect(mockProvision).not.toHaveBeenCalled();
  expect(result.data?.measurementTarget).toBe("channel");
  expect(result.data?.measuredReleaseId).toBe("test-sys-r000000");
  expect(warnMessages.some((m) => m.includes("test-sys-r000000"))).toBe(true);
  const missionCheckCalls = mockExecuteKernelCommand.mock.calls.filter(
    (c) => (c[0] as { commandName: string }).commandName === "mission.check",
  );
  expect(missionCheckCalls.length).toBe(1);
  const argv = (missionCheckCalls[0][0] as { argv: string[] }).argv;
  expect(argv).toContain("--base-url=https://dev.example.com");
});

test("AC-5: missing dist/server fails closed with exit 2 and release.prepare next step", async () => {
  // No releases/<id>/dist/server — candidate mode must not measure the channel.
  const opsDir = path.join(tmpDir, "systems-cache", SITE, "deployment-operations");
  await fs.mkdir(opsDir, { recursive: true });
  await fs.writeFile(
    path.join(opsDir, "op-1.json"),
    JSON.stringify({
      channel: "dev",
      state: "succeeded",
      deploymentUrl: "https://dev.example.com",
      releaseId: "test-sys-r000000",
      timestamp: "2026-10-05T00:00:00.000Z",
    }),
  );

  const result = await runLeitstandCertify(makeInput(baseFlags()), context);

  expect(result.exitCode).toBe(2);
  expect(result.data?.measurementTarget).toBe("candidate-preview");
  expect(
    result.nextSteps?.some((s) => s.action.includes("release.prepare") && s.kind === "required"),
  ).toBe(true);
  expect(mockProvision).not.toHaveBeenCalled();
  // The channel record must not have been measured — no producer ran at all.
  const missionCheckCalls = mockExecuteKernelCommand.mock.calls.filter(
    (c) => (c[0] as { commandName: string }).commandName === "mission.check",
  );
  expect(missionCheckCalls.length).toBe(0);
});

test("AC-7: preview teardown runs in finally even when the gate fails", async () => {
  await makeReleaseWithServerDir();
  // mission.check fails → gate evaluates against error diagnostics →
  // non-zero outcome path still tears the preview down.
  mockExecuteKernelCommand.mockResolvedValue({ ok: false, exitCode: 1, data: {}, summary: "boom" });

  await runLeitstandCertify(makeInput(baseFlags()), context);

  expect(previewStop).toHaveBeenCalledTimes(1);
});

test("invalid --target is rejected before any provisioning", async () => {
  await makeReleaseWithServerDir();

  await expect(
    runLeitstandCertify(makeInput(baseFlags({ target: "bogus" })), context),
  ).rejects.toThrow("--target");
  expect(mockProvision).not.toHaveBeenCalled();
});

test("evidence-reuse path reports candidate-preview target without booting a preview", async () => {
  await makeReleaseWithServerDir();
  // Pre-seed a reusable gate-decision + evidence sidecar keyed to the same
  // artifact hash — tryReuseEvidence satisfies the gate, no producers run.
  const decisionsDir = path.join(tmpDir, "systems-cache", SITE, "gate-decisions");
  await fs.mkdir(decisionsDir, { recursive: true });
  const evidence = {
    schema: "werkstatt/evidence-envelope@1",
    evidenceId: "ev-astro-mission-check-1",
    candidateId: SITE,
    producerId: "astro-mission-check",
    producerAttemptId: "op-0",
    producedAt: new Date().toISOString(),
    result: {
      schema: "werkstatt/evidence-result@1",
      producerId: "astro-mission-check",
      producerAttemptId: "op-0",
      diagnostics: [],
      bindingHash: ARTIFACT_HASH,
      applicability: { appliesTo: [], scope: "site" },
    },
    payloads: [],
    redaction: {
      schema: "werkstatt/redaction-report@1",
      policyVersion: "1.0.0",
      detectedSecrets: 0,
      detectedPii: 0,
      resolved: true,
      unresolvedSecrets: 0,
      unresolvedPii: 0,
    },
    authorityAdmission: {
      schema: "werkstatt/authority-admission@1",
      authoritySequence: 1,
      admittedAt: new Date().toISOString(),
      admittedBy: "leitstand.certify",
    },
    freshness: {
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      staleAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
  await fs.writeFile(
    path.join(decisionsDir, `${RELEASE}-evidence.json`),
    JSON.stringify({
      schema: "werkstatt/evidence-cache@1",
      releaseId: RELEASE,
      artifactHash: ARTIFACT_HASH,
      evidence: [evidence],
      producedAt: new Date().toISOString(),
      producedByGate: "dev",
    }),
  );
  await fs.writeFile(
    path.join(decisionsDir, `${RELEASE}-dev.json`),
    JSON.stringify({
      schema: "werkstatt/gate-decision@1",
      decisionId: "dec-prior",
      candidateId: SITE,
      policyBundleRoot: ARTIFACT_HASH,
      gate: "dev",
      evaluationCut: 1,
      selectedEvidence: [
        {
          evidenceId: "ev-astro-mission-check-1",
          evidenceHash: ARTIFACT_HASH,
          selectedAt: new Date().toISOString(),
        },
      ],
      status: "pass",
      coverage: {
        schema: "werkstatt/coverage-report@1",
        totalRequirements: 1,
        coveredRequirements: 1,
        uncoveredRequirements: [],
      },
      reasons: [],
      actionPackRef: null,
      decidedAt: new Date().toISOString(),
    }),
  );

  const result = await runLeitstandCertify(makeInput(baseFlags()), context);

  expect(mockProvision).not.toHaveBeenCalled();
  expect(result.data?.measurementTarget).toBe("candidate-preview");
  expect(result.data?.measuredReleaseId).toBe(RELEASE);
  expect(result.data?.preview?.artifactHash).toBe(ARTIFACT_HASH);
});
