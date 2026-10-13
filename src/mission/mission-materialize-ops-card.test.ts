/*
<MODULE_CONTRACT>
<purpose>RFC-1265: verify mission.materialize invokes ops.card.generate so every fresh workpiece carries a current .werkstatt/ops-card.yaml (AC-3).</purpose>
<keywords>RFC-1265, mission.materialize, ops.card.generate, ops-card, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1265: initial test — ops.card.generate invoked with --site during materialize; failure is non-fatal.</item>
  <item>RFC-1265</item>
  <item>RFC-1275: steps 1-5: journal-portal domain, six blocks, binding emission</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

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
  runAppBoilerplateValidate: vi.fn(async () => ({
    data: { generated: [] },
    summary: "ok",
    nextSteps: [],
  })),
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
  generateWorkpiecePackageJson: vi.fn(() => ({ packageJson: "{}", resolved: [] })),
  readTemplateFields: vi.fn(() => ({})),
  resolveBasePath: vi.fn(() => ""),
  resolveAdapterBlock: vi.fn(() => ""),
  resolveJournalBindingsBlock: vi.fn(() => ""),
}));

vi.mock("@warpgogol/werkstatt-site/checks", () => ({
  runEnvExampleGenerate: vi.fn(async () => []),
  MISSION_PREFLIGHT_CRITICAL: [],
  MISSION_PREFLIGHT_WARNING: [],
  toOwnershipEntries: vi.fn(() => []),
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
  testRoot = mkdtempSync(join(tmpdir(), "tmp-mat-opscard-"));
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
  writeFileSync(
    join(cacheDir, "system-config.yaml"),
    `schemaVersion: system-config/v1
id: test-system
cosmicStar: Vega
mirrors:
  - path: "../systems-cache/test-system"
    storageType: non-bare
pinnedPlatform: "1.0.0"
status: active
registeredAt: "2026-01-01T00:00:00Z"
notes: ""
`,
  );
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

test("RFC-1265: mission.materialize invokes ops.card.generate for the workpiece site", async () => {
  setupWorkspace();

  const { runMissionMaterialize } = await import("../mission/mission-materialize.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  await runMissionMaterialize(input, context);

  const cardCall = mockExecuteKernelCommand.calls.find(
    (c) => c.commandName === "ops.card.generate",
  );
  expect(cardCall).toBeDefined();
  expect(cardCall!.argv).toContain("--site=test-system");
});

test("RFC-1265: ops.card.generate failure is non-fatal (materialization succeeds)", async () => {
  setupWorkspace();

  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
  vi.mocked(executeKernelCommand).mockImplementation(async (opts) => {
    if (opts.commandName === "ops.card.generate") {
      throw new Error("card compile failed");
    }
    return [{ ok: true, exitCode: 0, summary: "" }] as never;
  });

  const { runMissionMaterialize } = await import("../mission/mission-materialize.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionMaterialize(input, context);
  expect(result.summary).toContain("materialized");
});
