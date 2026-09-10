/*
<MODULE_CONTRACT>
  <purpose>RFC-1065: Unit tests for lagebild.connect, lagebild.validate, lagebild.status commands.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1065: initial lagebild command tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock registry-io
vi.mock("../sternsystem/registry-io.ts", () => ({
  readSystemConfigSmart: vi.fn(),
  readSystemStateSmart: vi.fn(),
  writeSystemStateSmart: vi.fn(),
  resolveCacheClonePath: vi.fn((root: string, id: string) => `${root}/../systems-cache/${id}`),
}));

// Mock wrangler-secrets
vi.mock("../leitstand/adapters/wrangler-secrets.ts", () => ({
  runWranglerSecretPut: vi.fn(),
  runWranglerSecretDelete: vi.fn(),
}));

// Mock adapters
vi.mock("../leitstand/adapters/index.ts", () => ({
  sourceDotenv: vi.fn(async () => ({})),
  filterEnv: vi.fn((env: Record<string, string | undefined>) => env),
}));

// Mock node:fs and node:fs/promises for .env read/write
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

// Mock node:child_process for wrangler secret list (used by validate handler)
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const { runLagebildConnect } = await import("./lagebild-connect.ts");
const { runLagebildValidate } = await import("./lagebild-validate.ts");
const { runLagebildStatus } = await import("./lagebild-status.ts");
const { readSystemConfigSmart, readSystemStateSmart, writeSystemStateSmart } =
  await import("../sternsystem/registry-io.ts");
const { runWranglerSecretPut } = await import("../leitstand/adapters/wrangler-secrets.ts");
const { existsSync } = await import("node:fs");

function mockSpawnChild(stdout: string, stderr: string = "", exitCode: number = 0) {
  const dataCbs: ((d: Buffer) => void)[] = [];
  const stderrCbs: ((d: Buffer) => void)[] = [];
  const exitCbs: ((code: number | null) => void)[] = [];
  mockSpawn.mockReturnValueOnce({
    stdout: {
      on: (_event: string, cb: (d: Buffer) => void) => {
        if (_event === "data") dataCbs.push(cb);
      },
    },
    stderr: {
      on: (_event: string, cb: (d: Buffer) => void) => {
        if (_event === "data") stderrCbs.push(cb);
      },
    },
    on: (event: string, cb: (...args: unknown[]) => void) => {
      if (event === "exit") exitCbs.push(cb as (code: number | null) => void);
    },
    stdin: {
      write: () => {},
      end: () => {
        for (const cb of dataCbs) cb(Buffer.from(stdout));
        if (stderr) for (const cb of stderrCbs) cb(Buffer.from(stderr));
        for (const cb of exitCbs) cb(exitCode);
      },
    },
  });
}

function makeInput(flags: Record<string, unknown>) {
  return { flags, argv: [] } as unknown as Parameters<typeof runLagebildConnect>[0];
}

function makeContext(workspaceRoot: string) {
  return { workspaceRoot, dryRun: false, site: undefined } as unknown as Parameters<
    typeof runLagebildConnect
  >[1];
}

const mockConfig = {
  schemaVersion: "1.0.0",
  id: "test-site",
  cosmicStar: "Vega",
  mirrors: [{ path: "../systems-cache/test-site", storageType: "non-bare" as const }],
  pinnedPlatform: "6.276.132",
  status: "active" as const,
  registeredAt: "2026-01-01T00:00:00Z",
  deployment: {
    adapter: "cloudflare-workers" as const,
    channels: {
      dev: { workerName: "test-site-dev", url: "https://dev.test-site.example" },
      alt: { workerName: "test-site-alt", url: "https://alt.test-site.example" },
      main: { workerName: "test-site-main", url: "https://test-site.example" },
    },
  },
};

const mockState = {
  schemaVersion: "1.0.0",
  systemId: "test-site",
  currentMission: null,
  lastRelease: null,
  lastPropagated: {},
  accessPin: null,
  passportRequired: false,
  ownershipRequired: false,
};

beforeEach(() => {
  vi.mocked(readSystemConfigSmart).mockReset();
  vi.mocked(readSystemStateSmart).mockReset();
  vi.mocked(writeSystemStateSmart).mockReset();
  vi.mocked(runWranglerSecretPut).mockReset();
  vi.mocked(existsSync).mockReset();
  mockReadFile.mockReset();
  mockWriteFile.mockReset();
  mockFetch.mockReset();
  mockSpawn.mockReset();

  vi.mocked(readSystemConfigSmart).mockResolvedValue(structuredClone(mockConfig) as never);
  vi.mocked(readSystemStateSmart).mockResolvedValue(structuredClone(mockState) as never);
  vi.mocked(writeSystemStateSmart).mockResolvedValue(undefined as never);
  vi.mocked(runWranglerSecretPut).mockResolvedValue({
    exitCode: 0,
    stdout: "",
    stderr: "",
  } as never);
  mockFetch.mockResolvedValue({ ok: true, status: 200 } as never);
  vi.mocked(existsSync).mockReturnValue(false);
  mockReadFile.mockResolvedValue("");
  mockWriteFile.mockResolvedValue(undefined);
});

describe("RFC-1065: lagebild.connect", () => {
  it("AC-1: pushes 4 LAGEBILD_* secrets via runWranglerSecretPut", async () => {
    await runLagebildConnect(
      makeInput({
        site: "test-site",
        "api-url": "https://api.lagebild.example",
        "api-key": "secret-key-123",
        "tenant-id": "tenant-1",
        "source-system-id": "src-1",
        channel: "main",
      }),
      makeContext("/tmp/test"),
    );
    expect(runWranglerSecretPut).toHaveBeenCalledTimes(4);
    const calls = vi.mocked(runWranglerSecretPut).mock.calls;
    const secretNames = calls.map((c) => c[1]);
    expect(secretNames).toContain("LAGEBILD_API_URL");
    expect(secretNames).toContain("LAGEBILD_API_KEY");
    expect(secretNames).toContain("LAGEBILD_TENANT_ID");
    expect(secretNames).toContain("LAGEBILD_SOURCE_SYSTEM_ID");
  });

  it("AC-2: returns per-secret pushed: boolean", async () => {
    vi.mocked(runWranglerSecretPut)
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "error" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    const result = await runLagebildConnect(
      makeInput({
        site: "test-site",
        "api-url": "https://api.lagebild.example",
        "api-key": "secret-key-123",
        "tenant-id": "tenant-1",
      }),
      makeContext("/tmp/test"),
    );
    expect(result.data!.secrets).toHaveLength(4);
    const pushedFlags = result.data!.secrets.map((s) => s.pushed);
    expect(pushedFlags).toContain(false);
    expect(pushedFlags).toContain(true);
  });

  it("AC-3: resolves workerName from system-config.yaml for specified channel", async () => {
    await runLagebildConnect(
      makeInput({
        site: "test-site",
        "api-url": "https://api.lagebild.example",
        "api-key": "secret-key-123",
        "tenant-id": "tenant-1",
        channel: "dev",
      }),
      makeContext("/tmp/test"),
    );
    expect(runWranglerSecretPut).toHaveBeenCalled();
    const firstCall = vi.mocked(runWranglerSecretPut).mock.calls[0];
    expect(firstCall[0]).toBe("test-site-dev");
  });

  it("AC-4: rejects empty --api-key", async () => {
    await expect(
      runLagebildConnect(
        makeInput({
          site: "test-site",
          "api-url": "https://api.lagebild.example",
          "api-key": "",
          "tenant-id": "tenant-1",
        }),
        makeContext("/tmp/test"),
      ),
    ).rejects.toThrow("--api-key");
  });

  it("AC-12: writes lagebild block to system-state.yaml", async () => {
    await runLagebildConnect(
      makeInput({
        site: "test-site",
        "api-url": "https://api.lagebild.example",
        "api-key": "secret-key-123",
        "tenant-id": "tenant-1",
        "source-system-id": "src-1",
        channel: "main",
      }),
      makeContext("/tmp/test"),
    );
    expect(writeSystemStateSmart).toHaveBeenCalledTimes(1);
    const writtenState = vi.mocked(writeSystemStateSmart).mock.calls[0][2] as typeof mockState & {
      lagebild?: { connected: boolean; apiUrl: string; tenantId: string };
    };
    expect(writtenState.lagebild).toBeDefined();
    expect(writtenState.lagebild!.connected).toBe(true);
    expect(writtenState.lagebild!.apiUrl).toBe("https://api.lagebild.example");
    expect(writtenState.lagebild!.tenantId).toBe("tenant-1");
  });

  it("AC-11: throws 'Site not found' when system-config.yaml is missing", async () => {
    const enoentError = new Error("ENOENT: no such file or directory");
    vi.mocked(readSystemConfigSmart).mockRejectedValueOnce(enoentError as never);
    await expect(
      runLagebildConnect(
        makeInput({
          site: "missing-site",
          "api-url": "https://api.lagebild.example",
          "api-key": "secret-key-123",
          "tenant-id": "tenant-1",
        }),
        makeContext("/tmp/test"),
      ),
    ).rejects.toThrow("not found");
  });

  it("throws if --site is missing", async () => {
    await expect(
      runLagebildConnect(
        makeInput({ "api-url": "u", "api-key": "k", "tenant-id": "t" }),
        makeContext("/tmp/test"),
      ),
    ).rejects.toThrow("--site is required");
  });

  it("throws if --api-url is missing", async () => {
    await expect(
      runLagebildConnect(
        makeInput({ site: "s", "api-key": "k", "tenant-id": "t" }),
        makeContext("/tmp/test"),
      ),
    ).rejects.toThrow("--api-url is required");
  });

  it("throws if --tenant-id is missing", async () => {
    await expect(
      runLagebildConnect(
        makeInput({ site: "s", "api-url": "u", "api-key": "k" }),
        makeContext("/tmp/test"),
      ),
    ).rejects.toThrow("--tenant-id is required");
  });

  it("defaults source-system-id to site_<id> when not provided", async () => {
    await runLagebildConnect(
      makeInput({
        site: "test-site",
        "api-url": "https://api.lagebild.example",
        "api-key": "secret-key-123",
        "tenant-id": "tenant-1",
      }),
      makeContext("/tmp/test"),
    );
    const writtenState = vi.mocked(writeSystemStateSmart).mock.calls[0][2] as typeof mockState & {
      lagebild?: { sourceSystemId: string };
    };
    expect(writtenState.lagebild!.sourceSystemId).toBe("site_test-site");
  });
});

describe("RFC-1065: lagebild.validate", () => {
  it("AC-5: checks 4 LAGEBILD_* secrets via wrangler secret list", async () => {
    mockSpawnChild(
      "LAGEBILD_API_URL  2024-01-01T00:00:00Z\nLAGEBILD_API_KEY  2024-01-01T00:00:00Z\nLAGEBILD_TENANT_ID  2024-01-01T00:00:00Z\nLAGEBILD_SOURCE_SYSTEM_ID  2024-01-01T00:00:00Z\n",
    );
    const result = await runLagebildValidate(
      makeInput({ site: "test-site", channel: "main" }),
      makeContext("/tmp/test"),
    );
    expect(result.data!.secrets).toHaveLength(4);
    expect(result.data!.secrets.map((s) => s.name)).toEqual([
      "LAGEBILD_API_URL",
      "LAGEBILD_API_KEY",
      "LAGEBILD_TENANT_ID",
      "LAGEBILD_SOURCE_SYSTEM_ID",
    ]);
  });

  it("AC-6: returns allSecretsPresent: true when all 4 secrets present", async () => {
    mockSpawnChild(
      "LAGEBILD_API_URL  2024-01-01T00:00:00Z\nLAGEBILD_API_KEY  2024-01-01T00:00:00Z\nLAGEBILD_TENANT_ID  2024-01-01T00:00:00Z\nLAGEBILD_SOURCE_SYSTEM_ID  2024-01-01T00:00:00Z\n",
    );
    const result = await runLagebildValidate(
      makeInput({ site: "test-site" }),
      makeContext("/tmp/test"),
    );
    expect(result.data!.allSecretsPresent).toBe(true);
  });

  it("AC-6: returns allSecretsPresent: false and exitCode 1 when secrets missing", async () => {
    mockSpawnChild("LAGEBILD_API_URL  2024-01-01T00:00:00Z\n");
    const result = await runLagebildValidate(
      makeInput({ site: "test-site" }),
      makeContext("/tmp/test"),
    );
    expect(result.data!.allSecretsPresent).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("AC-11: throws 'Site not found' when system-config.yaml is missing", async () => {
    const enoentError = new Error("ENOENT: no such file or directory");
    vi.mocked(readSystemConfigSmart).mockRejectedValueOnce(enoentError as never);
    await expect(
      runLagebildValidate(makeInput({ site: "missing-site" }), makeContext("/tmp/test")),
    ).rejects.toThrow("not found");
  });

  it("throws if --site is missing", async () => {
    await expect(runLagebildValidate(makeInput({}), makeContext("/tmp/test"))).rejects.toThrow(
      "--site is required",
    );
  });

  it("returns state.connected from system-state.yaml", async () => {
    mockSpawnChild(
      "LAGEBILD_API_URL  2024-01-01T00:00:00Z\nLAGEBILD_API_KEY  2024-01-01T00:00:00Z\nLAGEBILD_TENANT_ID  2024-01-01T00:00:00Z\nLAGEBILD_SOURCE_SYSTEM_ID  2024-01-01T00:00:00Z\n",
    );
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce({
      ...mockState,
      lagebild: {
        connected: true,
        apiUrl: "https://api.lagebild.example",
        tenantId: "tenant-1",
        sourceSystemId: "src-1",
        connectedAt: "2026-01-01T00:00:00Z",
        channel: "main",
      },
    } as never);
    const result = await runLagebildValidate(
      makeInput({ site: "test-site" }),
      makeContext("/tmp/test"),
    );
    expect(result.data!.state.connected).toBe(true);
  });
});

describe("RFC-1065: lagebild.status", () => {
  it("AC-7: reads system-state.yaml via readSystemStateSmart", async () => {
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce({
      ...mockState,
      lagebild: {
        connected: true,
        apiUrl: "https://api.lagebild.example",
        tenantId: "tenant-1",
        sourceSystemId: "src-1",
        connectedAt: "2026-01-01T00:00:00Z",
        channel: "main",
      },
    } as never);
    const result = await runLagebildStatus(
      makeInput({ site: "test-site" }),
      makeContext("/tmp/test"),
    );
    expect(readSystemStateSmart).toHaveBeenCalledWith("/tmp/test", "test-site");
    expect(result.data!.connected).toBe(true);
    expect(result.data!.apiUrl).toBe("https://api.lagebild.example");
    expect(result.data!.tenantId).toBe("tenant-1");
    expect(result.data!.channel).toBe("main");
  });

  it("AC-8: returns connected: false when lagebild block is undefined", async () => {
    const result = await runLagebildStatus(
      makeInput({ site: "test-site" }),
      makeContext("/tmp/test"),
    );
    expect(result.data!.connected).toBe(false);
  });

  it("AC-9: does not make network calls", async () => {
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(mockState as never);
    await runLagebildStatus(makeInput({ site: "test-site" }), makeContext("/tmp/test"));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws if --site is missing", async () => {
    await expect(runLagebildStatus(makeInput({}), makeContext("/tmp/test"))).rejects.toThrow(
      "--site is required",
    );
  });
});
