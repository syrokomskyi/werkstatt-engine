/*
<MODULE_CONTRACT>
  <purpose>RFC-1065: Unit tests for lagebild.connect, lagebild.validate, lagebild.status commands.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1065: initial lagebild command tests.</item>
  <item>warpgogol-m000170: EC-16 — isolate workspace root in a per-run tmpdir sandbox so
    resolveCacheClonePath resolves to a private systems-cache pool; un-quarantine
    from .flaky-tests.json.</item>
  <item>RFC-1198: cookie-free referral attribution — /r/<slug> partner landings + voluntary referrer field

Replace the RFC-1191 wg_ref cookie capture with URL+form attribution:
static /r/<slug> and /<lang>/r/<slug> partner landings (noindex, zero JS,
consent-gated via publicNameConsentRef), ?ref prefill on the existing
referrerField rail, server-side slug resolution against the bundled
partners.yaml, referral_partner_slug/name on the Lagebild ingress contract,
legacy /?ref -> /r/<slug> 302 in the generated worker, and full removal of
the cookie capture module (wg_ref, referral.attribution entitlement,
payload.attribution).</item>
</CHANGE_SUMMARY>
*/

import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

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

// Mock node:fs and node:fs/promises for .env read/write.
// Spread-actual: the WorkspaceIO default adapter needs the rest of the real
// fs surface (rename, mkdir, stat, …) — full replacement leaves them undefined.
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: vi.fn(() => false),
}));

const { mockReadFile, mockWriteFile, mockSpawn } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockSpawn: vi.fn(),
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

// Mock node:child_process for wrangler secret list (used by validate handler)
vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const { runLagebildConnect } = await import("./lagebild-connect.ts");
const { runLagebildValidate } = await import("./lagebild-validate.ts");
const { runLagebildStatus } = await import("./lagebild-status.ts");
const { runLagebildReferralIssue, runLagebildReferralList } =
  await import("./lagebild-referral.ts");
const { sourceDotenv } = await import("../leitstand/adapters/index.ts");
const { readSystemConfigSmart, readSystemStateSmart, writeSystemStateSmart } =
  await import("../sternsystem/registry-io.ts");
const { runWranglerSecretPut } = await import("../leitstand/adapters/wrangler-secrets.ts");
const { existsSync } = await import("node:fs");

function mockSpawnChild(stdout: string, stderr: string = "", exitCode: number = 0) {
  const dataCbs: ((d: Buffer) => void)[] = [];
  const stderrCbs: ((d: Buffer) => void)[] = [];
  const exitCbs: ((code: number | null) => void)[] = [];
  const mockChild = {
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
      if (event === "exit" || event === "close") exitCbs.push(cb as (code: number | null) => void);
    },
    stdin: {
      write: () => {},
      end: () => {},
    },
    kill: () => {},
  };
  // execImpl listens on "close" and never calls stdin.end — the fire must be
  // scheduled when spawn() is invoked (not at mockSpawnChild setup): fs awaits
  // between setup and io.exec would burn the event-loop turn and fire with
  // empty handler arrays. Handlers attach synchronously after spawn returns.
  mockSpawn.mockImplementationOnce(() => {
    setImmediate(() => {
      for (const cb of dataCbs) cb(Buffer.from(stdout));
      if (stderr) for (const cb of stderrCbs) cb(Buffer.from(stderr));
      for (const cb of exitCbs) cb(exitCode);
    });
    return mockChild;
  });
}

function makeInput(flags: Record<string, unknown>) {
  return { flags, argv: [] } as unknown as Parameters<typeof runLagebildConnect>[0];
}

// EC-16: the workspace root feeds `resolveCacheClonePath` → "<root>/../systems-cache/<id>".
// A shared literal like /tmp/test makes sibling-pool test files race on
// /tmp/systems-cache (ENOENT flakes under `vitest related`). Per-run sandbox keeps
// this file isolated; teardown removes it.
const workRoot = mkdtempSync(join(tmpdir(), "lagebild-commands-"));

afterAll(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

function makeContext() {
  return {
    io: createDefaultIO().io,
    workspaceRoot: workRoot,
    dryRun: false,
    site: undefined,
  } as unknown as Parameters<typeof runLagebildConnect>[1];
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

beforeEach(async () => {
  vi.mocked(readSystemConfigSmart).mockReset();
  vi.mocked(readSystemStateSmart).mockReset();
  vi.mocked(writeSystemStateSmart).mockReset();
  vi.mocked(runWranglerSecretPut).mockReset();
  vi.mocked(existsSync).mockReset();
  mockReadFile.mockReset();
  mockWriteFile.mockReset();
  mockFetch.mockReset();
  mockSpawn.mockReset();

  // io.writeFile goes through writeFileAtomic (temp write + fsRename) — a bare
  // vi.fn() no-ops the temp write and rename fails ENOENT. Route the mocks to
  // the real fs; per-test mockResolvedValue can still override.
  const realFsPromises =
    await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  mockReadFile.mockImplementation(realFsPromises.readFile as never);
  mockWriteFile.mockImplementation(realFsPromises.writeFile as never);

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
      makeContext(),
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
      makeContext(),
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
      makeContext(),
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
        makeContext(),
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
      makeContext(),
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
        makeContext(),
      ),
    ).rejects.toThrow("not found");
  });

  it("throws if --site is missing", async () => {
    await expect(
      runLagebildConnect(
        makeInput({ "api-url": "u", "api-key": "k", "tenant-id": "t" }),
        makeContext(),
      ),
    ).rejects.toThrow("--site is required");
  });

  it("throws if --api-url is missing", async () => {
    await expect(
      runLagebildConnect(makeInput({ site: "s", "api-key": "k", "tenant-id": "t" }), makeContext()),
    ).rejects.toThrow("--api-url is required");
  });

  it("throws if --tenant-id is missing", async () => {
    await expect(
      runLagebildConnect(makeInput({ site: "s", "api-url": "u", "api-key": "k" }), makeContext()),
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
      makeContext(),
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
      makeContext(),
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
    const result = await runLagebildValidate(makeInput({ site: "test-site" }), makeContext());
    expect(result.data!.allSecretsPresent).toBe(true);
  });

  it("AC-6: returns allSecretsPresent: false and exitCode 1 when secrets missing", async () => {
    mockSpawnChild("LAGEBILD_API_URL  2024-01-01T00:00:00Z\n");
    const result = await runLagebildValidate(makeInput({ site: "test-site" }), makeContext());
    expect(result.data!.allSecretsPresent).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("AC-11: throws 'Site not found' when system-config.yaml is missing", async () => {
    const enoentError = new Error("ENOENT: no such file or directory");
    vi.mocked(readSystemConfigSmart).mockRejectedValueOnce(enoentError as never);
    await expect(
      runLagebildValidate(makeInput({ site: "missing-site" }), makeContext()),
    ).rejects.toThrow("not found");
  });

  it("throws if --site is missing", async () => {
    await expect(runLagebildValidate(makeInput({}), makeContext())).rejects.toThrow(
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
    const result = await runLagebildValidate(makeInput({ site: "test-site" }), makeContext());
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
    const result = await runLagebildStatus(makeInput({ site: "test-site" }), makeContext());
    expect(readSystemStateSmart).toHaveBeenCalledWith(workRoot, "test-site");
    expect(result.data!.connected).toBe(true);
    expect(result.data!.apiUrl).toBe("https://api.lagebild.example");
    expect(result.data!.tenantId).toBe("tenant-1");
    expect(result.data!.channel).toBe("main");
  });

  it("AC-8: returns connected: false when lagebild block is undefined", async () => {
    const result = await runLagebildStatus(makeInput({ site: "test-site" }), makeContext());
    expect(result.data!.connected).toBe(false);
  });

  it("AC-9: does not make network calls", async () => {
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(mockState as never);
    await runLagebildStatus(makeInput({ site: "test-site" }), makeContext());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws if --site is missing", async () => {
    await expect(runLagebildStatus(makeInput({}), makeContext())).rejects.toThrow(
      "--site is required",
    );
  });
});

const connectedLagebildState = {
  ...mockState,
  lagebild: {
    connected: true,
    apiUrl: "https://api.lagebild.example",
    tenantId: "tenant-1",
    sourceSystemId: "src-1",
    connectedAt: "2026-01-01T00:00:00Z",
    channel: "main",
  },
};

describe("RFC-1198: lagebild.referral.issue", () => {
  beforeEach(() => {
    vi.mocked(readSystemStateSmart).mockResolvedValue(
      structuredClone(connectedLagebildState) as never,
    );
    vi.mocked(sourceDotenv).mockResolvedValue({ LAGEBILD_API_KEY: "key-1" } as never);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ slug: "anna" }),
    } as never);
  });

  const issue = (flags: Record<string, string>) =>
    runLagebildReferralIssue(makeInput(flags), makeContext());

  it("AC-8: POSTs /v1/referrals and returns {slug, url} with the channel origin", async () => {
    const result = await issue({
      site: "test-site",
      slug: "anna",
      name: "Anna Beispiel",
      contact: "rec@example.test",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.lagebild.example/v1/referrals");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      slug: "anna",
      display_name: "Anna Beispiel",
      contact_email: "rec@example.test",
    });
    expect(result.data!.slug).toBe("anna");
    expect(result.data!.url).toBe("https://test-site.example/r/anna");
  });

  it("uses the requested channel origin for the /r/ URL", async () => {
    const result = await issue({
      site: "test-site",
      slug: "anna",
      name: "Anna Beispiel",
      channel: "alt",
    });
    expect(result.data!.url).toBe("https://alt.test-site.example/r/anna");
  });

  it("omits contact_email when --contact is absent", async () => {
    await issue({ site: "test-site", slug: "anna", name: "Anna Beispiel" });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      slug: "anna",
      display_name: "Anna Beispiel",
    });
  });

  it("throws when the site is not connected to Lagebild", async () => {
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(structuredClone(mockState) as never);
    await expect(issue({ site: "test-site", slug: "anna", name: "Anna" })).rejects.toThrow(
      "lagebild.connect",
    );
  });

  it("throws if --site is missing", async () => {
    await expect(issue({ slug: "anna", name: "Anna" })).rejects.toThrow("--site is required");
  });

  it("throws if --slug is missing or malformed", async () => {
    await expect(issue({ site: "test-site", name: "Anna" })).rejects.toThrow("--slug");
    await expect(issue({ site: "test-site", slug: "Anna!", name: "Anna" })).rejects.toThrow(
      "--slug",
    );
  });

  it("throws if --name is missing", async () => {
    await expect(issue({ site: "test-site", slug: "anna" })).rejects.toThrow("--name");
  });
});

describe("RFC-1198: lagebild.referral.list", () => {
  beforeEach(() => {
    vi.mocked(readSystemStateSmart).mockResolvedValue(
      structuredClone(connectedLagebildState) as never,
    );
    vi.mocked(sourceDotenv).mockResolvedValue({ LAGEBILD_API_KEY: "key-1" } as never);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rows: [{ slug: "anna", display_name: "Anna Beispiel" }] }),
    } as never);
  });

  it("AC-9: issues an HTTP request and returns the registry rows", async () => {
    const result = await runLagebildReferralList(makeInput({ site: "test-site" }), makeContext());
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.lagebild.example/v1/referrals");
    expect(init.method).toBe("GET");
    expect(result.data!.rows).toHaveLength(1);
  });
});
