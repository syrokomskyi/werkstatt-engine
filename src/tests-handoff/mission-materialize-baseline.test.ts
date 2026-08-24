/*
<MODULE_CONTRACT>
<purpose>RFC-0617: unit test verifying compass.audit.baseline --workpiece is called during mission.materialize.</purpose>
<keywords>RFC-0617, mission.materialize, compass.audit.baseline, workpiece, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0617: initial test verifying compass.audit.baseline is called with --workpiece flag after codegen.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";

const mockExecuteKernelCommand = vi.hoisted(() => ({
  calls: [] as Array<{ commandName: string; argv?: string[] }>,
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelPipeline: vi.fn(async () => [
      { ok: true, steps: [{ ok: true, commandName: "config.regenerate", exitCode: 0 }] },
    ]),
    executeKernelCommand: vi.fn(async (opts: { commandName: string; argv?: string[] }) => {
      mockExecuteKernelCommand.calls.push({ commandName: opts.commandName, argv: opts.argv });
      return [{ ok: true, exitCode: 0, summary: "" }];
    }),
    runKernelWire: vi.fn(async () => ({ data: { generated: [] } })),
  };
});

vi.mock("../bordbuch/bordbuch-io.ts", () => ({
  validateBordbuch: vi.fn(async () => ({ entries: 0, violations: [] })),
  readBordbuch: vi.fn(async () => []),
  commitAndPushBordbuch: vi.fn(async () => ({
    commitSha: "abc123",
    pushed: true,
    error: null,
  })),
}));

vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: vi.fn(async () => ({
    entry: { id: "event-000001", kind: "mission-materialize" },
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  })),
}));

vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    resolveCacheClonePath: vi.fn((workspaceRoot: string, systemId: string) =>
      join(workspaceRoot, "..", "systems-cache", systemId),
    ),
    readSystemConfigSmart: vi.fn(async () => ({
      schemaVersion: "system-config/v1",
      id: "test-system",
      cosmicStar: "Vega",
      mirrors: [{ path: "../systems-cache/test-system", storageType: "non-bare" }],
      pinnedPlatform: "1.0.0",
      status: "active",
      registeredAt: "2026-01-01T00:00:00Z",
      notes: "",
    })),
    readSystemState: vi.fn(async () => ({
      schemaVersion: "1.0.0",
      id: "test-system",
      currentMission: "test-system-m000001",
      lastRelease: null,
    })),
    writeSystemState: vi.fn(async () => {}),
  };
});

vi.mock("@warpgogol/werkstatt-site/codegen", () => ({
  runGenerateAgentsDocs: vi.fn(async () => []),
  runGenerateApiRoutes: vi.fn(async () => []),
  runGenerateGlobalStyles: vi.fn(async () => []),
  runGenerateI18nMiddleware: vi.fn(async () => []),
  runGenerateOverlayPages: vi.fn(async () => []),
  runGeneratePublicInfrastructure: vi.fn(async () => []),
  runGenerateRoutes: vi.fn(async () => []),
  runGenerateScriptsOrchestrator: vi.fn(async () => []),
  runFontsImportsGenerate: vi.fn(async () => []),
  runBiomeCssGenerate: vi.fn(async () => []),
  runAppBoilerplateValidate: vi.fn(async () => ({ data: { generated: [] }, summary: "ok", nextSteps: [] })),
  runGenerateMaterialCreditsPage: vi.fn(async () => []),
  runPropsTypesGenerate: vi.fn(async () => []),
  runGenerateIcons: vi.fn(async () => []),
  runCleanIcons: vi.fn(async () => []),
  runGenerateOpenSourcePage: vi.fn(async () => []),
  runSectionScaffold: vi.fn(async () => []),
  runSystemMdCompile: vi.fn(async () => []),
  runLegalScaffold: vi.fn(async () => []),
  runMaterialMetadataWrite: vi.fn(async () => []),
  runContentRefIndexGenerate: vi.fn(async () => []),
  runContentRefMigrate: vi.fn(async () => []),
  runContentFormulaMigrate: vi.fn(async () => []),
  buildGeneratedHeader: vi.fn(() => ""),
  hasGeneratedMarker: vi.fn(() => false),
  stripGeneratedMarker: vi.fn((s: string) => s),
  GENERATED_MARKER: "GENERATED",

}));

vi.mock("@warpgogol/werkstatt-site/onboarding", () => ({
  applyTokens: vi.fn((s: string) => s),
  readTemplate: vi.fn(() => ""),
  readRuntimeTemplate: vi.fn(() => ""),
}));

vi.mock("@warpgogol/werkstatt-site/checks", () => ({
  runEnvExampleGenerate: vi.fn(async () => []),
  MISSION_PREFLIGHT_CRITICAL: [],
  MISSION_PREFLIGHT_WARNING: [],
  GENERATOR_OWNERSHIP_MAP: [],
}));

function gitInit(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let testRoot: string;
let tmpWorkspace: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-mat-baseline-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
  mockExecuteKernelCommand.calls = [];
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupWorkspace(): string {
  gitInit(testRoot);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  writeFileSync(join(tmpWorkspace, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  writeFileSync(join(tmpWorkspace, "pnpm-workspace.yaml"), "packages: []\n");
  gitCommit(testRoot, "initial");

  const cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(cacheDir, { recursive: true });
  const configContent = `schemaVersion: system-config/v1
id: test-system
cosmicStar: Vega
mirrors:
  - path: "../systems-cache/test-system"
    storageType: non-bare
pinnedPlatform: "1.0.0"
status: active
registeredAt: "2026-01-01T00:00:00Z"
notes: ""
`;
  writeFileSync(join(cacheDir, "system-config.yaml"), configContent);
  gitCommit(testRoot, "add system config");

  writeFileSync(
    join(cacheDir, "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "");
  mkdirSync(join(cacheDir, "src", "content"), { recursive: true });
  writeFileSync(
    join(cacheDir, "src", "content", "system.md"),
    "---\n  domain: test\n  i18n:\n    default: de\n    languages:\n      - de\n---\n",
  );
  gitCommit(testRoot, "add system");

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  mkdirSync(join(missionDir, "workpiece"), { recursive: true });
  mkdirSync(join(missionDir, "evidence"), { recursive: true });

  const manifest = {
    schemaVersion: "1.0.0",
    missionId: "test-system-m000001",
    systemId: "test-system",
    state: "open",
    brief: "Test mission",
    openedAt: "2026-07-30T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: null,
    migratedAt: null,
    reconciledAt: null,
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  gitCommit(testRoot, "add mission");
  return cacheDir;
}

test("RFC-0617: mission.materialize calls compass.audit.baseline with --workpiece flag", async () => {
  setupWorkspace();

  const { runMissionMaterialize } = await import("../mission/mission-materialize.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  await runMissionMaterialize(input, context);

  const baselineCall = mockExecuteKernelCommand.calls.find(
    (c) => c.commandName === "compass.audit.baseline",
  );

  expect(baselineCall).toBeDefined();
  expect(baselineCall!.argv).toBeDefined();
  expect(baselineCall!.argv!.some((a) => a.startsWith("--workpiece="))).toBe(true);
  expect(
    baselineCall!.argv!.some((a) => a.includes("missions/test-system-m000001/workpiece")),
  ).toBe(true);
});

test("RFC-0617: compass.audit.baseline failure is non-fatal (materialization succeeds)", async () => {
  setupWorkspace();

  // Override the mock to throw for compass.audit.baseline
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
  vi.mocked(executeKernelCommand).mockImplementationOnce(async (opts) => {
    if (opts.commandName === "compass.audit.baseline") {
      throw new Error("baseline failed");
    }
    return [{ ok: true, exitCode: 0, summary: "" }] as never;
  });

  const { runMissionMaterialize } = await import("../mission/mission-materialize.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionMaterialize(input, context);

  // Materialization should succeed despite baseline failure
  expect(result.summary).toContain("materialized");
});
