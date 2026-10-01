import { test, expect, describe, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1138 AC-4: leitstand.promote invokes sternsystem.sync after a
    successful promote when mirrors[2+] are configured — non-fatal, with
    mirror.synced reported in the result data.
  </purpose>
</MODULE_CONTRACT>
*/

const executeKernelCommandMock = vi.fn<(opts: { commandName: string }) => Promise<unknown>>();

vi.mock("@warpgogol/werkstatt-engine/kernel", () => ({
  executeKernelCommand: (opts: { commandName: string }) => executeKernelCommandMock(opts),
  KERNEL_UNIVERSAL_FLAGS: [],
}));

vi.mock("../deploy-helpers.ts", () => ({
  authorizeAndDeploy: vi.fn(),
  verifyDurableSync: vi.fn(async () => true),
  authorizeMainPromotion: vi.fn(async () => ({
    authorization: {
      ok: true,
      outcome: { decisionId: "dec-1", ruleId: "ok", message: "ok" },
    },
    mainVerification: { ok: true, decisionId: "mv-1" },
  })),
  buildEffectRecord: vi.fn(() => ({})),
  writeDeploymentEffectRecord: vi.fn(async () => {}),
  makeR2ConfigFromEnv: vi.fn(() => undefined),
  resolveArtifactHash: vi.fn(async () => ({ hash: "abc123", source: "flag", path: undefined })),
  resolveGateDecisionPath: vi.fn(
    (_dir: string, _rel: string, _gate: string, flag?: string) => flag ?? "/tmp/gate.json",
  ),
  flagSite: vi.fn((input: { flags: Record<string, unknown> }) => input.flags["site"] as string),
}));

const executeDeployPhasesMock = vi.fn();
vi.mock("../deploy-execution.ts", () => ({
  executeDeployPhases: (ctx: unknown, channel: string) => executeDeployPhasesMock(ctx, channel),
  buildAuthHeader: vi.fn(() => ({})),
}));

const readSystemConfigMock = vi.fn();
const channel = { workerName: "acme", url: "https://acme.example" };
vi.mock("../../sternsystem/registry-io.ts", () => ({
  readSystemConfigSmart: vi.fn(async () => ({
    deployment: {
      adapter: "null",
      channels: { dev: channel, alt: channel, main: channel },
    },
  })),
  readSystemStateSmart: vi.fn(async () => ({})),
  resolveCacheClonePath: vi.fn((root: string, id: string) => path.join(root, "systems-cache", id)),
  readSystemConfig: () => readSystemConfigMock(),
  resolveMirrorPath: vi.fn((root: string, p: string) => path.join(root, p)),
}));

vi.mock("../../customdomain/customdomain-register.ts", () => ({
  runCustomdomainRegister: vi.fn(async () => ({ exitCode: 0 })),
}));
vi.mock("../../customdomain/redirect-register.ts", () => ({
  runRedirectRegister: vi.fn(async () => ({ exitCode: 0 })),
}));

vi.mock("../adapters/index.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../adapters/index.ts")>()),
  createCloudflareWorkersAdapter: vi.fn(() => ({ name: "cloudflare" })),
  createGitHubPagesAdapter: vi.fn(() => ({ name: "gh-pages" })),
  readBehaviorSnapshot: vi.fn(async () => null),
  sourceDotenv: vi.fn(async () => ({})),
  filterEnv: vi.fn((e: Record<string, string | undefined>) => e),
}));

vi.mock("../cache-purge.ts", () => ({
  collectPurgeUrls: vi.fn(() => []),
  purgeCacheByUrls: vi.fn(async () => ({})),
  skippedPurgeResult: vi.fn(() => ({})),
  verifyCloudflareToken: vi.fn(async () => true),
  BUILD_IDENTITY_PATH: ".well-known/build-identity.json",
}));

vi.mock("../../artifact-store/index.ts", () => ({
  artifactStorePreflight: vi.fn(async () => {}),
}));
vi.mock("../../integrity/signing.ts", () => ({
  verifyBuildIdentitySignature: vi.fn(async () => ({ ok: true })),
}));

const { runLeitstandPromote } = await import("../leitstand-commands.ts");

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

function makeInput(systemId: string, releaseId: string) {
  return {
    flags: { site: systemId, release: releaseId, "artifact-hash": "abc123" },
    argv: [],
  } as never;
}

describe("leitstand.promote — RFC-1138 post-promote mirror sync", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "promote-"));
    await fs.mkdir(path.join(tmpDir, "systems-cache", "acme", "gate-decisions"), {
      recursive: true,
    });
    executeKernelCommandMock.mockReset();
    executeDeployPhasesMock.mockReset();
    readSystemConfigMock.mockReset();
    executeDeployPhasesMock.mockResolvedValue({
      deploymentUrl: "https://acme.example",
      failingPhase: undefined,
      freshness: { verified: true },
      evidenceSynced: true,
      purgeResult: undefined,
      healthState: "healthy",
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("AC-4: successful promote with mirrors[2+] invokes sternsystem.sync", async () => {
    readSystemConfigMock.mockResolvedValue({
      mirrors: [
        { path: "../cache" },
        { path: "../bare.git" },
        { path: "https://github.com/example/acme.git" },
      ],
    });
    executeKernelCommandMock.mockResolvedValue({ exitCode: 0, summary: "synced" });

    const result = (await runLeitstandPromote(
      makeInput("acme", "acme-r000001"),
      makeContext(tmpDir),
    )) as { data: { mirror?: { synced: boolean; syncError: string | null } }; exitCode: number };

    expect(result.exitCode).toBe(0);
    const syncCall = executeKernelCommandMock.mock.calls.find(
      (c) => c[0].commandName === "sternsystem.sync",
    );
    expect(syncCall).toBeDefined();
    expect(syncCall![0]).toMatchObject({ argv: ["--id=acme"] });
    expect(result.data.mirror).toEqual({ synced: true, syncError: null });
  });

  test("AC-4: sync failure is non-fatal — promote still succeeds, mirror.synced=false", async () => {
    readSystemConfigMock.mockResolvedValue({
      mirrors: [
        { path: "../cache" },
        { path: "../bare.git" },
        { path: "https://github.com/example/acme.git" },
      ],
    });
    executeKernelCommandMock.mockResolvedValue({ exitCode: 1, summary: "push rejected" });

    const result = (await runLeitstandPromote(
      makeInput("acme", "acme-r000001"),
      makeContext(tmpDir),
    )) as { data: { mirror?: { synced: boolean; syncError: string | null } }; exitCode: number };

    expect(result.exitCode).toBe(0);
    expect(result.data.mirror).toEqual({ synced: false, syncError: "push rejected" });
  });

  test("AC-4: no external mirrors → no sync call, mirror undefined", async () => {
    readSystemConfigMock.mockResolvedValue({
      mirrors: [{ path: "../cache" }, { path: "../bare.git" }],
    });

    const result = (await runLeitstandPromote(
      makeInput("acme", "acme-r000001"),
      makeContext(tmpDir),
    )) as { data: { mirror?: unknown }; exitCode: number };

    expect(result.exitCode).toBe(0);
    const syncCall = executeKernelCommandMock.mock.calls.find(
      (c) => c[0].commandName === "sternsystem.sync",
    );
    expect(syncCall).toBeUndefined();
    expect(result.data.mirror).toBeUndefined();
  });

  test("AC-4: failed promote skips the sync call", async () => {
    readSystemConfigMock.mockResolvedValue({
      mirrors: [
        { path: "../cache" },
        { path: "../bare.git" },
        { path: "https://github.com/example/acme.git" },
      ],
    });
    executeDeployPhasesMock.mockResolvedValue({
      deploymentUrl: "",
      failingPhase: "wrangler-deploy",
      freshness: { verified: false },
      evidenceSynced: false,
      healthState: "unknown",
    });

    const result = (await runLeitstandPromote(
      makeInput("acme", "acme-r000001"),
      makeContext(tmpDir),
    )) as { exitCode: number };

    expect(result.exitCode).toBe(1);
    const syncCall = executeKernelCommandMock.mock.calls.find(
      (c) => c[0].commandName === "sternsystem.sync",
    );
    expect(syncCall).toBeUndefined();
  });
});
