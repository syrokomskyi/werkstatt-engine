/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for cold e2e covering werkstatt.e2e.cold. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
  <non-goals>
    <item>Does not test real git clone or pnpm install — all external calls are mocked.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0965: initial unit tests for cold run handler — interventions, timeout, dirty tree, confinement, success.</item>
  <item>RFC-1307: canonical org-singleton PBP paths, seeded hreflang+publication.gate, full rollback</item>
  <item>RFC-1324: fixture-staging + compose mocks — DirEntry/fs.Stats-shaped io mocks, real INTAKE-01..15 validation on staged bundles, skipped-stage awareness</item>
  <item>RFC-1324</item>
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
let mockStat: any;
let mockCopyFile: any;

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  // io.exec goes through spawn — emulate execFileSync semantics: return value
  // becomes stdout + close(0), a thrown error becomes stderr + close(status).
  // Fire is scheduled at spawn() call time so execImpl's handlers are attached
  // before the callbacks run.
  spawn: (cmd: string, args?: string[]) => {
    let dataCb: ((d: Buffer) => void) | undefined;
    let errCb: ((d: Buffer) => void) | undefined;
    const closeCbs: ((code: number | null) => void)[] = [];
    setImmediate(() => {
      try {
        const out = mockExecFileSync(cmd, args);
        dataCb?.(Buffer.from(String(out ?? "")));
        for (const cb of closeCbs) cb(0);
      } catch (err) {
        const e = err as { stderr?: Buffer | string; status?: number };
        if (e?.stderr) errCb?.(Buffer.from(String(e.stderr)));
        for (const cb of closeCbs) cb(typeof e?.status === "number" ? e.status : 1);
      }
    });
    return {
      stdout: {
        on: (e: string, cb: (d: Buffer) => void) => {
          if (e === "data") dataCb = cb;
        },
      },
      stderr: {
        on: (e: string, cb: (d: Buffer) => void) => {
          if (e === "data") errCb = cb;
        },
      },
      on: (e: string, cb: (...a: unknown[]) => void) => {
        if (e === "close" || e === "exit") closeCbs.push(cb as (c: number | null) => void);
      },
      stdin: { write: () => {}, end: () => {} },
      kill: () => {},
    };
  },
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
    stat: (...args: unknown[]) => mockStat(...args),
    copyFile: (...args: unknown[]) => mockCopyFile(...args),
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

// Real fs for mock impls: io.writeFile goes through writeFileAtomic (temp write
// + real fsRename) and io.mkdir/fsMkdir must create the parent dir — bare
// vi.fn() no-ops leave rename ENOENT and write ENOENT.
const realFsPromises = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

import { runColdE2e } from "../e2e/cold.ts";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { getPublicKey, loadPrivateKey, toHex } from "@warpgogol/werkstatt-engine/signing";

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
    io: createDefaultIO().io,
    actualState: {} as never,
  };
}

describe("werkstatt.e2e.cold", () => {
  let tmpDir: string;

  beforeEach(() => {
    mockExecFileSync = vi.fn();
    mockMkdtemp = vi.fn(async () => join(tmpDir, "cold-root"));
    mockMkdir = vi.fn(async (p: string) => {
      await realFsPromises.mkdir(p, { recursive: true });
    });
    mockWriteFile = vi.fn(async (p: string, c: string | Uint8Array) => {
      await realFsPromises.writeFile(p, c);
    });
    // Path-aware reads: the staged fixture intake.json (confirmed domain so the
    // register stage isn't secrets-gated), MANIFEST, the seeded system.md, the
    // signing key.
    mockReadFile = vi.fn(async (p: unknown) => {
      const s = String(p);
      if (s.endsWith("MANIFEST.sha256")) return "00  intake.json\n";
      if (s.endsWith("intake.json"))
        return '{"systemId":"dp7","classification":{"domain":"e2e.test","locales":[{"tag":"de","role":"primary"}]}}';
      if (s.endsWith("system.md"))
        return "---\ni18n:\n  default: de\n  supported:\n    de:\n      name: de\n      hreflang: de-DE\nidentity:\n  systemStar: Achernar\n  biome: handwerk-material-warm\nlegalJurisdiction: DE\npublication:\n  gate: enforce\ncontractTerms:\n  gate: enforce\nprovenance:\n  gate: enforce\n---\n";
      return "PEM";
    });
    // DirEntry-shaped listings for fixture discovery, intake staging, mission
    // lookup and the composition tree.
    mockReaddir = vi.fn(async (p: unknown) => {
      const s = String(p);
      const file = (name: string) => ({ name, isFile: () => true, isDirectory: () => false });
      const dir = (name: string) => ({ name, isFile: () => false, isDirectory: () => true });
      if (s.endsWith("intake/fixtures") || s.endsWith("intake\\fixtures"))
        return [dir("valid-minimal")];
      if (s.endsWith("valid-minimal")) return [file("intake.json"), file("MANIFEST.sha256")];
      if (s.endsWith("missions")) return [dir("e2e-valid-minimal-m000001")];
      if (s.endsWith("composition")) return [dir("pages"), file("system.md")];
      if (s.endsWith("pages")) return [file("home.md")];
      return [];
    });
    mockRm = vi.fn(async () => undefined);
    mockExistsSync = vi.fn(() => true);
    // Dirs have no extension in the mocked tree (pages, composition), files do.
    // fs.Stats shape: isFile()/isDirectory() are methods the io adapter calls.
    mockStat = vi.fn(async (p: unknown) => ({
      isFile: () => String(p).includes("."),
      isDirectory: () => !String(p).includes("."),
      mtimeMs: 0,
      size: 0,
    }));
    mockCopyFile = vi.fn(async () => undefined);

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
    const seededSystemMd =
      "---\ni18n:\n  default: de\n  supported:\n    de:\n      name: de\n      hreflang: de-DE\nidentity:\n  systemStar: Achernar\n  biome: handwerk-material-warm\nlegalJurisdiction: DE\npublication:\n  gate: enforce\ncontractTerms:\n  gate: enforce\nprovenance:\n  gate: enforce\n---\n";
    mockReadFile = vi.fn(async (p: unknown) => {
      const s = String(p);
      if (s.endsWith("MANIFEST.sha256")) return "00  intake.json\n";
      if (s.endsWith("intake.json"))
        return '{"systemId":"dp7","classification":{"domain":"e2e.test","locales":[{"tag":"de","role":"primary"}]}}';
      if (s.endsWith("system.md")) return seededSystemMd;
      return "PEM";
    });

    mockedExec.mockImplementation((cmdInput: { commandName?: string }) => {
      const name = cmdInput?.commandName ?? "";
      if (name === "sternsystem.handover.prepare") {
        return Promise.resolve({
          commandName: name,
          exitCode: 0,
          ok: true,
          data: {
            dryRun: true,
            signedAuthorization: { mock: true },
            authorizationHash: "mock-hash",
          },
          metadata: {} as never,
          logs: [],
          timing: {} as never,
        });
      }
      if (name === "mission.open") {
        return Promise.resolve({
          commandName: name,
          exitCode: 0,
          ok: true,
          data: { missionId: "e2e-valid-minimal-m000002" },
          metadata: {} as never,
          logs: [],
          timing: {} as never,
        });
      }
      if (name === "sternsystem.handover.complete") {
        return Promise.resolve({
          commandName: name,
          exitCode: 0,
          ok: true,
          data: {
            dryRun: true,
            newPassportHashPreview: "mock-hash-preview",
            bordbuchEventPreview: { kind: "handover" },
            registryTransferPreview: { previousOwner: "a", newOwner: "b" },
          },
          metadata: {} as never,
          logs: [],
          timing: {} as never,
        });
      }
      return Promise.resolve({
        commandName: name || "sternsystem.register",
        exitCode: 0,
        ok: true,
        data: { firstMissionId: "m000001" },
        metadata: {} as never,
        logs: [],
        timing: {} as never,
      });
    });

    const result = await runColdE2e(makeInput({}), makeContext(tmpDir) as never);

    if (result.exitCode !== 0) {
      console.log(JSON.stringify(result.data?.fixtures[0]?.steps, null, 1));
    }
    expect(result.exitCode).toBe(0);
    expect(result.data?.fixtures[0]?.interventions).toBe(0);
    expect(result.data?.fixtures[0]?.steps.every((s: { ok: boolean }) => s.ok)).toBe(true);
  });

  it("hands the recipient key to handover.complete and restores the sender key (HANDOVER-04)", async () => {
    mockExecFileSync.mockReturnValue("");
    const seededSystemMd =
      "---\ni18n:\n  default: de\n  supported:\n    de:\n      name: de\n      hreflang: de-DE\nidentity:\n  systemStar: Achernar\n  biome: handwerk-material-warm\nlegalJurisdiction: DE\npublication:\n  gate: enforce\ncontractTerms:\n  gate: enforce\nprovenance:\n  gate: enforce\n---\n";
    mockReadFile = vi.fn(async (p: unknown) => {
      const s = String(p);
      if (s.endsWith("MANIFEST.sha256")) return "00  intake.json\n";
      if (s.endsWith("intake.json"))
        return '{"systemId":"dp7","classification":{"domain":"e2e.test","locales":[{"tag":"de","role":"primary"}]}}';
      if (s.endsWith("system.md")) return seededSystemMd;
      return "PEM";
    });

    let recipientPublicKey = "";
    let completeSawRecipientKey = false;
    mockedExec.mockImplementation(async (cmdInput: { commandName?: string; argv?: string[] }) => {
      const name = cmdInput?.commandName ?? "";
      if (name === "sternsystem.handover.prepare") {
        const keyArg = (cmdInput.argv ?? []).find((a) => a.startsWith("--recipient-public-key="));
        recipientPublicKey = keyArg?.split("=")[1] ?? "";
        return {
          commandName: name,
          exitCode: 0,
          ok: true,
          data: { dryRun: true, signedAuthorization: { mock: true }, authorizationHash: "h" },
          metadata: {} as never,
          logs: [],
          timing: {} as never,
        };
      }
      if (name === "sternsystem.handover.complete") {
        // HANDOVER-04 semantics: complete runs as the recipient — the env key
        // must derive the public key the sender authorized, not the sender's.
        const pem = process.env.SIGNING_PRIVATE_KEY ?? "";
        const derived = toHex(await getPublicKey(await loadPrivateKey({ pem })));
        completeSawRecipientKey = derived === recipientPublicKey && pem !== "PEM";
        return {
          commandName: name,
          exitCode: 0,
          ok: true,
          data: { dryRun: true, newPassportHashPreview: "h" },
          metadata: {} as never,
          logs: [],
          timing: {} as never,
        };
      }
      return {
        commandName: name || "sternsystem.register",
        exitCode: 0,
        ok: true,
        data: { firstMissionId: "m000001", missionId: "m000002" },
        metadata: {} as never,
        logs: [],
        timing: {} as never,
      };
    });

    const result = await runColdE2e(makeInput({}), makeContext(tmpDir) as never);

    expect(result.exitCode).toBe(0);
    expect(recipientPublicKey).not.toBe("");
    expect(completeSawRecipientKey).toBe(true);
    // Sender key restored for later stages.
    expect(process.env.SIGNING_PRIVATE_KEY).toBe("PEM");
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
    expect(result.data?.fixtures[0]?.steps.some((s: { ok: boolean }) => !s.ok)).toBe(true);
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
    expect(result.data?.fixtures[0]?.timedOut).toBe(true);
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
