/*
<MODULE_CONTRACT>
  <purpose>RFC-1136: unit tests for runLeitstandHealth releaseId resolution — state-file lookup, --release override, and the no-release-recorded path.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1136: initial tests covering AC-1 (releaseId resolved from lastPropagated), AC-2 (--release override), AC-3 (explicit unknown when no release recorded).</item>
  <item>RFC-1136: resolve deployed releaseId in leitstand.health before probing</item>
</CHANGE_SUMMARY>
*/

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../sternsystem/registry-io.ts", () => ({
  readSystemConfigSmart: vi.fn(),
  readSystemStateSmart: vi.fn(),
  resolveCacheClonePath: vi.fn(),
}));

const healthCalls: Array<Record<string, unknown>> = [];

vi.mock("../adapters/index.ts", () => ({
  createCloudflareWorkersAdapter: vi.fn(() => ({
    name: "cloudflare-workers",
    propagate: vi.fn(),
    rollback: vi.fn(),
    health: vi.fn(async (input: Record<string, unknown>) => {
      healthCalls.push(input);
      return {
        state: "healthy" as const,
        checks: [
          {
            name: "probe:/",
            url: `${input.deploymentUrl}/`,
            status: 200,
            passed: true,
            detail: "Content hash matches",
          },
        ],
      };
    }),
    getLimits: vi.fn(() => ({ maxTotalSize: 0, maxFileSize: 0 })),
    purgeCapable: vi.fn(() => true),
  })),
  createGitHubPagesAdapter: vi.fn(),
  readBehaviorSnapshot: vi.fn(),
  sourceDotenv: vi.fn(),
  filterEnv: vi.fn(),
  verifyRedirectRoute: vi.fn(),
  selectProbeRoutes: vi.fn(),
  fetchWithRetry: vi.fn(),
  createDefaultCommandRunner: vi.fn(),
}));

const { runLeitstandHealth } = await import("../leitstand-commands.ts");
const { readSystemConfigSmart, readSystemStateSmart } =
  await import("../../sternsystem/registry-io.ts");

function makeInput(flags: Record<string, unknown>) {
  return { flags, argv: [] } as unknown as Parameters<typeof runLeitstandHealth>[0];
}

function makeContext(workspaceRoot: string) {
  return { workspaceRoot, dryRun: false, site: undefined } as unknown as Parameters<
    typeof runLeitstandHealth
  >[1];
}

const defaultConfig = {
  schemaVersion: "1.0.0",
  id: "test-site",
  deployment: {
    adapter: "cloudflare-workers" as const,
    channels: {
      dev: { workerName: "dev-test", url: "https://dev.test.com" },
      alt: { workerName: "alt-test", url: "https://alt.test.com" },
      main: { workerName: "test", url: "https://test.com" },
    },
  },
};

function stateWithRelease(channel: "dev" | "alt" | "main", releaseId: string) {
  return {
    schemaVersion: "1.0.0",
    systemId: "test-site",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {
      [channel]: {
        releaseId,
        at: "2026-09-23T10:00:00.000Z",
        healthy: true,
        state: "succeeded" as const,
        operationId: "op-1",
        leaseExpiresAt: null,
      },
    },
  };
}

describe("runLeitstandHealth (RFC-1136)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    healthCalls.length = 0;
    vi.mocked(readSystemConfigSmart).mockResolvedValue(defaultConfig as never);
  });

  it("AC-1: resolves releaseId from system-state.yaml lastPropagated before probing", async () => {
    vi.mocked(readSystemStateSmart).mockResolvedValue(
      stateWithRelease("main", "warpgogol-r000035") as never,
    );

    const result = await runLeitstandHealth(
      makeInput({ site: "test-site", channel: "main" }),
      makeContext("/tmp/ws"),
    );

    expect(
      healthCalls.length,
      "adapter.health must be called exactly once — the command resolves releaseId before probing",
    ).toBe(1);
    expect(
      healthCalls[0]?.releaseId,
      "adapter.health must receive the releaseId recorded in lastPropagated.main — an empty string made every probe return unknown",
    ).toBe("warpgogol-r000035");
    expect(result.data?.state).toBe("healthy");
  });

  it("AC-2: --release flag overrides the state-file lookup", async () => {
    vi.mocked(readSystemStateSmart).mockResolvedValue(
      stateWithRelease("main", "warpgogol-r000035") as never,
    );

    await runLeitstandHealth(
      makeInput({ site: "test-site", channel: "main", release: "ad-hoc-r999999" }),
      makeContext("/tmp/ws"),
    );

    expect(
      healthCalls[0]?.releaseId,
      "--release must win over lastPropagated — it exists for ad-hoc checks of non-recorded releases",
    ).toBe("ad-hoc-r999999");
  });

  it("AC-3: reports explicit unknown when no release is recorded for the channel", async () => {
    vi.mocked(readSystemStateSmart).mockResolvedValue({
      schemaVersion: "1.0.0",
      systemId: "test-site",
      currentMission: null,
      lastRelease: null,
      lastPropagated: {},
    } as never);

    const result = await runLeitstandHealth(
      makeInput({ site: "test-site", channel: "main" }),
      makeContext("/tmp/ws"),
    );

    expect(result.data?.state).toBe("unknown");
    expect(
      result.summary,
      "missing release record must produce an actionable detail, not a silent empty probe",
    ).toContain("no release recorded");
    expect(
      healthCalls.length,
      "adapter.health must not be called when no releaseId can be resolved",
    ).toBe(0);
  });
});
