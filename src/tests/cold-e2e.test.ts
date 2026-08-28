/*
<MODULE_CONTRACT>
  <purpose>Unit tests for werkstatt.e2e.cold command handler (RFC-0965).</purpose>
  <keywords>e2e, cold, test, RFC-0965</keywords>
  <non-goals>
    <item>Does not test real git clone or pnpm install — all external calls are mocked.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0965: initial unit tests for cold run handler — interventions, timeout, dirty tree, confinement, success.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let mockExecFileSync: any;
let mockMkdtemp: any;
let mockMkdir: any;
let mockWriteFile: any;
let mockReadFile: any;
let mockReaddir: any;
let mockRm: any;
let mockExistsSync: any;

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mocked = {
    mkdtemp: (...args: unknown[]) => mockMkdtemp(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    readdir: (...args: unknown[]) => mockReaddir(...args),
    rm: (...args: unknown[]) => mockRm(...args),
  };
  return {
    ...actual,
    ...mocked,
    default: { ...actual, ...mocked },
  };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  };
});

vi.mock("@warpgogol/werkstatt-engine/kernel", () => ({
  executeKernelCommand: vi.fn(),
  KERNEL_UNIVERSAL_FLAGS: {},
}));

import { runColdE2e } from "../e2e/cold.ts";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";

const mockedExec = vi.mocked(executeKernelCommand);

function makeInput(flags: Record<string, unknown>) {
  return { flags: flags as Record<string, never>, argv: [] };
}

function makeContext(workspaceRoot: string) {
  return {
    workspaceRoot,
    siteExplicit: false,
    logger: { info: () => {}, event: () => {}, getEvents: () => [] },
    dryRun: false,
    outputFormat: "pretty" as const,
    io: {} as never,
    registry: {} as never,
  };
}

describe("werkstatt.e2e.cold", () => {
  let tmpDir: string;

  beforeEach(() => {
    mockExecFileSync = vi.fn();
    mockMkdtemp = vi.fn(async () => join(tmpDir, "cold-root"));
    mockMkdir = vi.fn(async () => undefined);
    mockWriteFile = vi.fn(async () => undefined);
    mockReadFile = vi.fn(async () => "");
    mockReaddir = vi.fn(async () => [] as never);
    mockRm = vi.fn(async () => undefined);
    mockExistsSync = vi.fn(() => true);

    tmpDir = mkdtempSync(join(tmpdir(), "e2e-cold-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fails preflight when working tree is dirty", async () => {
    mockExecFileSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      const subArgs = args[1] as string[];
      if (cmd === "git" && subArgs?.[0] === "status") return " M src/foo.ts\n";
      return "";
    });

    const result = await runColdE2e(makeInput({}), makeContext(tmpDir) as never);

    expect(result.exitCode).toBe(1);
    expect(result.data?.summary).toContain("dirty");
  });

  it("returns interventions=0 and exit 0 when all steps succeed", async () => {
    mockExecFileSync.mockReturnValue("");
    mockReaddir = vi.fn(async () => ["m000001"] as never);
    mockReadFile = vi.fn(async () => "" as never);

    mockedExec.mockResolvedValue({
      commandName: "sternsystem.register",
      exitCode: 0,
      ok: true,
      data: { firstMissionId: "m000001" },
      metadata: {} as never,
      logs: [],
      timing: {} as never,
    });

    const result = await runColdE2e(makeInput({}), makeContext(tmpDir) as never);

    expect(result.exitCode).toBe(0);
    expect(result.data?.interventions).toBe(0);
    expect(result.data?.steps.every((s: { ok: boolean }) => s.ok)).toBe(true);
  });

  it("returns exit 1 when a sub-command fails", async () => {
    mockExecFileSync.mockReturnValue("");

    mockedExec.mockResolvedValue({
      commandName: "sternsystem.register",
      exitCode: 1,
      ok: false,
      data: {},
      metadata: {} as never,
      logs: [],
      timing: {} as never,
    });

    const result = await runColdE2e(makeInput({}), makeContext(tmpDir) as never);

    expect(result.exitCode).toBe(1);
    expect(result.data?.steps.some((s: { ok: boolean }) => !s.ok)).toBe(true);
  });

  it("tracks timedOut when a step times out", async () => {
    mockExecFileSync.mockReturnValue("");

    mockedExec.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                commandName: "sternsystem.register",
                exitCode: 0,
                ok: true,
                data: { firstMissionId: "m000001" },
                metadata: {} as never,
                logs: [],
                timing: {} as never,
              }),
            10000,
          ),
        ),
    );

    const result = await runColdE2e(
      makeInput({ "timeout-minutes": "0.01" }),
      makeContext(tmpDir) as never,
    );

    expect(result.exitCode).toBe(1);
    expect(result.data?.timedOut).toBe(true);
  });

  it("does not touch real systems-cache when cold run executes", async () => {
    const realCachePath = join(tmpDir, "systems-cache");
    mkdirSync(realCachePath, { recursive: true });
    writeFileSync(join(realCachePath, "marker.txt"), "preserve-me");

    mockExecFileSync.mockReturnValue("");

    mockedExec.mockResolvedValue({
      commandName: "sternsystem.register",
      exitCode: 0,
      ok: true,
      data: { firstMissionId: "m000001" },
      metadata: {} as never,
      logs: [],
      timing: {} as never,
    });

    await runColdE2e(makeInput({}), makeContext(tmpDir) as never);

    expect(statSync(join(realCachePath, "marker.txt")).size).toBe(11);
  });
});
