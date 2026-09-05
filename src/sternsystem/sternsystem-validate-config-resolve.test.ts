/*
<MODULE_CONTRACT>
  <purpose>RFC-1034: Test STERN-CONFIG-RESOLVE-01 warning in sternsystem.validate.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1034: initial tests for config resolution warning.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("../kernel/runtime/registry.ts", () => ({
  loadAppRuntime: vi.fn(),
}));

vi.mock("./registry-io.ts", () => ({
  discoverSystems: vi.fn().mockReturnValue([]),
  hasAppsCollision: vi.fn().mockReturnValue(false),
  resolveMirrors: vi.fn().mockReturnValue({ cachePath: "", gitMirrors: [], backupMirrors: [] }),
  resolveMirrorPath: vi.fn(),
  resolveWorkpiecePath: vi.fn(),
  readSystemState: vi.fn().mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-system",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
  }),
  isGitAccessible: vi.fn().mockReturnValue(true),
  readPassport: vi.fn().mockResolvedValue(null),
}));

vi.mock("../bordbuch/bordbuch-io.ts", () => ({
  readBordbuch: vi.fn().mockResolvedValue([]),
}));

vi.mock("../mission/env-persist.ts", () => ({
  collectEnvFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock("./external-edit-guard.ts", () => ({
  evaluateExternalEditGate: vi.fn().mockReturnValue({ violations: [], warnings: [] }),
}));

vi.mock("./external-edit-collector.ts", () => ({
  collectExternalEditInputs: vi.fn().mockResolvedValue({}),
  bordbuchFileExists: vi.fn().mockReturnValue(false),
  bordbuchPathFor: vi.fn(),
}));

vi.mock("./handover.ts", () => ({
  readAuthorization: vi.fn().mockResolvedValue(null),
  isAuthorizationExpired: vi.fn().mockReturnValue(false),
}));

vi.mock("./passport.ts", () => ({
  verifyPassport: vi.fn(),
  buildPassportPayload: vi.fn(),
  computePassportHash: vi.fn(),
}));

vi.mock("../schemas/naming-policy.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../schemas/naming-policy.ts")>();
  return {
    ...actual,
    hasTldSuffix: vi.fn().mockReturnValue(false),
  };
});

import { runSternsystemValidate } from "./sternsystem-validate.ts";
import { discoverSystems, resolveMirrors } from "./registry-io.ts";
import { loadAppRuntime } from "../kernel/runtime/registry.ts";

const mockDiscoverSystems = vi.mocked(discoverSystems);
const mockResolveMirrors = vi.mocked(resolveMirrors);
const mockLoadAppRuntime = vi.mocked(loadAppRuntime);

let tmpDir: string;

function makeContext(workspaceRoot: string) {
  return {
    workspaceRoot,
    logger: {
      section() {},
      info() {},
      warn() {},
      error() {},
      success() {},
    },
  } as never;
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "stern-config-resolve-XXXX-"));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("RFC-1034: STERN-CONFIG-RESOLVE-01", () => {
  it("emits warning when cache clone kernel.config.ts fails to load", async () => {
    const cachePath = path.join(tmpDir, "cache-clone");
    mkdirSync(path.join(cachePath, "tools"), { recursive: true });
    writeFileSync(path.join(cachePath, "tools", "kernel.config.ts"), "broken content");

    mockDiscoverSystems.mockReturnValue({
      systems: [
        {
          id: "test-system",
          mirrors: [{ path: cachePath, storageType: "git", branch: "main" }],
          owner: "test-owner",
        },
      ],
      errors: [],
    } as never);
    mockResolveMirrors.mockReturnValue({ cachePath, gitMirrors: [], backupMirrors: [] } as never);
    mockLoadAppRuntime.mockRejectedValue(
      new Error("Cannot find package '@warpgogol/werkstatt-engine'") as never,
    );

    const result = await runSternsystemValidate({ flags: {} } as never, makeContext(tmpDir));

    const data = result.data as { warnings: Array<{ field: string; message: string }> };
    const configWarning = data.warnings.find((w) => w.field === "STERN-CONFIG-RESOLVE-01");
    expect(configWarning).toBeTruthy();
    expect(configWarning!.message).toContain("kernel.config.ts failed to load");
    expect(configWarning!.message).toContain("@warpgogol/werkstatt-engine");
  });

  it("does not emit warning when kernel.config.ts loads successfully", async () => {
    const cachePath = path.join(tmpDir, "cache-clone");
    mkdirSync(path.join(cachePath, "tools"), { recursive: true });
    writeFileSync(path.join(cachePath, "tools", "kernel.config.ts"), "valid content");

    mockDiscoverSystems.mockReturnValue({
      systems: [
        {
          id: "test-system",
          mirrors: [{ path: cachePath, storageType: "git", branch: "main" }],
          owner: "test-owner",
        },
      ],
      errors: [],
    } as never);
    mockResolveMirrors.mockReturnValue({ cachePath, gitMirrors: [], backupMirrors: [] } as never);
    mockLoadAppRuntime.mockResolvedValue({ registry: { listCommandNames: () => [] } } as never);

    const result = await runSternsystemValidate({ flags: {} } as never, makeContext(tmpDir));

    const data = result.data as { warnings: Array<{ field: string; message: string }> };
    const configWarning = data.warnings.find((w) => w.field === "STERN-CONFIG-RESOLVE-01");
    expect(configWarning).toBeUndefined();
  });

  it("skips silently when cache clone has no kernel.config.ts", async () => {
    const cachePath = path.join(tmpDir, "cache-clone");
    mkdirSync(cachePath, { recursive: true });

    mockDiscoverSystems.mockReturnValue({
      systems: [
        {
          id: "test-system",
          mirrors: [{ path: cachePath, storageType: "git", branch: "main" }],
          owner: "test-owner",
        },
      ],
      errors: [],
    } as never);
    mockResolveMirrors.mockReturnValue({ cachePath, gitMirrors: [], backupMirrors: [] } as never);

    const result = await runSternsystemValidate({ flags: {} } as never, makeContext(tmpDir));

    const data = result.data as { warnings: Array<{ field: string; message: string }> };
    const configWarning = data.warnings.find((w) => w.field === "STERN-CONFIG-RESOLVE-01");
    expect(configWarning).toBeUndefined();
    expect(mockLoadAppRuntime).not.toHaveBeenCalled();
  });

  it("is non-fatal — STERN-CONFIG-RESOLVE-01 is a warning, not a violation", async () => {
    const cachePath = path.join(tmpDir, "cache-clone");
    mkdirSync(path.join(cachePath, "tools"), { recursive: true });
    writeFileSync(path.join(cachePath, "tools", "kernel.config.ts"), "broken");

    mockDiscoverSystems.mockReturnValue({
      systems: [
        {
          id: "test-system",
          mirrors: [{ path: cachePath, storageType: "git", branch: "main" }],
          owner: "test-owner",
        },
      ],
      errors: [],
    } as never);
    mockResolveMirrors.mockReturnValue({ cachePath, gitMirrors: [], backupMirrors: [] } as never);
    mockLoadAppRuntime.mockRejectedValue(new Error("module not found") as never);

    const result = await runSternsystemValidate({ flags: {} } as never, makeContext(tmpDir));

    const data = result.data as {
      warnings: Array<{ field: string; message: string }>;
      violations: Array<{ rule: string }>;
    };
    const configWarning = data.warnings.find((w) => w.field === "STERN-CONFIG-RESOLVE-01");
    expect(configWarning).toBeTruthy();
    const configViolation = data.violations.find((v) => v.rule === "STERN-CONFIG-RESOLVE-01");
    expect(configViolation).toBeUndefined();
  });
});
