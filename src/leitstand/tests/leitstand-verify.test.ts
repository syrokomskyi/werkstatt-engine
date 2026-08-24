/*
<MODULE_CONTRACT>
  <purpose>RFC-0930: unit tests for leitstand.verify command — fetches build-identity.json from live channels, compares distTreeHash cross-channel, optionally compares against local system-state.yaml.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0930: initial tests for leitstand.verify command covering all-match success, hash drift, unreachable channel, local mismatch, single-channel filter, access-protected channel, 404, no deployment config, --no-compare-local, and fetch timeout.</item>
</CHANGE_SUMMARY>
*/

import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../../sternsystem/registry-io.ts", () => ({
  readSystemConfigSmart: vi.fn(),
  readSystemStateSmart: vi.fn(),
  resolveCacheClonePath: vi.fn(),
}));

const { runLeitstandVerify } = await import("../leitstand-commands.ts");
const { readSystemConfigSmart, readSystemStateSmart } =
  await import("../../sternsystem/registry-io.ts");

function makeInput(flags: Record<string, unknown>) {
  return { flags, args: [] } as unknown as Parameters<typeof runLeitstandVerify>[0];
}

function makeContext(workspaceRoot: string) {
  return { workspaceRoot, dryRun: false, site: undefined } as unknown as Parameters<
    typeof runLeitstandVerify
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

const defaultState = {
  schemaVersion: "1.0.0",
  systemId: "test-site",
  currentMission: null,
  lastRelease: null,
  lastPropagated: {
    dev: {
      releaseId: "r000005",
      at: "2026-08-23T12:00:00.000Z",
      healthy: true,
      state: "succeeded" as const,
      operationId: "op-1",
      leaseExpiresAt: null,
    },
    alt: {
      releaseId: "r000005",
      at: "2026-08-23T13:00:00.000Z",
      healthy: true,
      state: "succeeded" as const,
      operationId: "op-2",
      leaseExpiresAt: null,
    },
    main: {
      releaseId: "r000005",
      at: "2026-08-23T14:00:00.000Z",
      healthy: true,
      state: "succeeded" as const,
      operationId: "op-3",
      leaseExpiresAt: null,
    },
  },
  accessPin: null as string | null,
};

function mockBuildIdentity(distTreeHash: string, releaseId = "r000005") {
  return JSON.stringify({
    distTreeHash,
    releaseId,
    missionId: "m000076",
    buildTimestamp: "2026-08-23T12:45:06Z",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RFC-0930: leitstand.verify", () => {
  it("all-match success: all channels reachable, same hash, match local → exitCode 0", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(mockBuildIdentity("sha256:abc123"), { status: 200 })),
    );

    const result = await runLeitstandVerify(makeInput({ site: "test-site" }), makeContext("/tmp"));

    expect(result.exitCode).toBe(0);
    expect(result.data!.crossChannel.allReachable).toBe(true);
    expect(result.data!.crossChannel.allSameHash).toBe(true);
    expect(result.data!.crossChannel.commonHash).toBe("sha256:abc123");
    expect(result.data!.channels).toHaveLength(3);
    for (const ch of result.data!.channels) {
      expect(ch.matchesLocal).toBe(true);
      expect(ch.reachable).toBe(true);
    }
  });

  it("hash drift: channels return different distTreeHash → exitCode 1", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);
    const hashes = ["sha256:aaa", "sha256:bbb", "sha256:ccc"];
    let callIndex = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const hash = hashes[callIndex++ % hashes.length];
      return Promise.resolve(new Response(mockBuildIdentity(hash), { status: 200 }));
    });

    const result = await runLeitstandVerify(makeInput({ site: "test-site" }), makeContext("/tmp"));

    expect(result.exitCode).toBe(1);
    expect(result.data!.crossChannel.allSameHash).toBe(false);
    expect(result.data!.crossChannel.commonHash).toBeNull();
  });

  it("unreachable channel: main returns HTTP 500 → exitCode 1", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("test.com/.well-known")) {
        return Promise.resolve(new Response("Internal Server Error", { status: 500 }));
      }
      return Promise.resolve(new Response(mockBuildIdentity("sha256:abc"), { status: 200 }));
    });

    const result = await runLeitstandVerify(makeInput({ site: "test-site" }), makeContext("/tmp"));

    expect(result.exitCode).toBe(1);
    expect(result.data!.crossChannel.allReachable).toBe(false);
    const mainCh = result.data!.channels.find((c) => c.channel === "main");
    expect(mainCh?.reachable).toBe(false);
    expect(mainCh?.httpStatus).toBe(500);
  });

  it("local mismatch: live releaseId differs from system-state.yaml → exitCode 1", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(mockBuildIdentity("sha256:abc", "r000099"), { status: 200 })),
    );

    const result = await runLeitstandVerify(makeInput({ site: "test-site" }), makeContext("/tmp"));

    expect(result.exitCode).toBe(1);
    for (const ch of result.data!.channels) {
      expect(ch.matchesLocal).toBe(false);
    }
  });

  it("single-channel filter: --channel dev → only dev in output", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(mockBuildIdentity("sha256:abc"), { status: 200 })),
    );

    const result = await runLeitstandVerify(
      makeInput({ site: "test-site", channel: "dev" }),
      makeContext("/tmp"),
    );

    expect(result.data!.channels).toHaveLength(1);
    expect(result.data!.channels[0].channel).toBe("dev");
  });

  it("access-protected channel: auth header sent when accessPin is set", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce({
      ...defaultState,
      accessPin: "1234",
    } as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(new Response(mockBuildIdentity("sha256:abc"), { status: 200 })),
      );

    await runLeitstandVerify(makeInput({ site: "test-site" }), makeContext("/tmp"));

    expect(fetchSpy).toHaveBeenCalled();
    const callArgs = fetchSpy.mock.calls[0];
    const options = callArgs?.[1] as RequestInit | undefined;
    expect(options?.headers).toHaveProperty("Authorization");
    const authHeader = (options?.headers as Record<string, string>)?.Authorization;
    expect(authHeader).toMatch(/^Basic /);
    expect(atob(authHeader!.replace("Basic ", ""))).toBe("warp:1234");
  });

  it("build-identity 404: channel returns 404 → buildIdentity null, error set", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("Not Found", { status: 404 })),
    );

    const result = await runLeitstandVerify(makeInput({ site: "test-site" }), makeContext("/tmp"));

    expect(result.exitCode).toBe(1);
    for (const ch of result.data!.channels) {
      expect(ch.buildIdentity).toBeNull();
      expect(ch.error).toBe("build-identity.json not found");
    }
  });

  it("no deployment config: returns empty channels, exitCode 0", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce({
      schemaVersion: "1.0.0",
      id: "test-site",
      deployment: undefined,
    } as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);

    const result = await runLeitstandVerify(makeInput({ site: "test-site" }), makeContext("/tmp"));

    expect(result.exitCode).toBe(0);
    expect(result.data!.channels).toHaveLength(0);
    expect(result.data!.crossChannel.allReachable).toBe(true);
    expect(result.data!.crossChannel.allSameHash).toBe(true);
    expect(result.summary).toContain("no deployment config");
  });

  it("--no-compare-local: matchesLocal is null for all channels", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(mockBuildIdentity("sha256:abc"), { status: 200 })),
    );

    const result = await runLeitstandVerify(
      makeInput({ site: "test-site", "compare-local": false }),
      makeContext("/tmp"),
    );

    for (const ch of result.data!.channels) {
      expect(ch.matchesLocal).toBeNull();
    }
  });

  it("fetch timeout: AbortError → reachable false, error mentions timeout", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });

    const result = await runLeitstandVerify(
      makeInput({ site: "test-site", "timeout-ms": "50" }),
      makeContext("/tmp"),
    );

    expect(result.exitCode).toBe(1);
    for (const ch of result.data!.channels) {
      expect(ch.reachable).toBe(false);
      expect(ch.error).toContain("timeout");
    }
  });

  it("throws if --site is missing", async () => {
    await expect(runLeitstandVerify(makeInput({}), makeContext("/tmp"))).rejects.toThrow(
      "--site is required",
    );
  });

  it("--system alias works as --site", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(mockBuildIdentity("sha256:abc"), { status: 200 })),
    );

    const result = await runLeitstandVerify(
      makeInput({ system: "test-site" }),
      makeContext("/tmp"),
    );

    expect(result.data!.systemId).toBe("test-site");
  });
});
