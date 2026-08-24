/*
<MODULE_CONTRACT>
<purpose>RFC-0597: unit tests for materialization state file preflight skip logic in mission.materialize.</purpose>
<keywords>RFC-0597, mission.materialize, preflight, skip, state file, cache clone HEAD</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0597: initial tests for state-file-based preflight skip and --skip-preflight flag precedence.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createMaterializeWorkspace, gitHead } from "./helpers/materialize-fixture.ts";
import { expectData } from "./helpers/kernel-result-helpers.ts";
import { tmpdir } from "node:os";

const mockPipeline = vi.hoisted(() => ({
  pipelineResult: {
    ok: true,
    steps: [{ ok: true, commandName: "config.regenerate", exitCode: 0 }],
  },
  pipelineNameUsed: "" as string,
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelPipeline: vi.fn(async (opts: { pipelineName: string }) => {
      mockPipeline.pipelineNameUsed = opts.pipelineName;
      return [mockPipeline.pipelineResult];
    }),
    executeKernelCommand: vi.fn(async () => [{ ok: true, exitCode: 0, summary: "" }]),
    runKernelWire: vi.fn(async () => ({ data: { generated: [] } })),
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

vi.mock("@warpgogol/werkstatt-site/checks", () => ({
  runEnvExampleGenerate: vi.fn(async () => []),
  MISSION_PREFLIGHT_CRITICAL: [],
  MISSION_PREFLIGHT_WARNING: [],
  GENERATOR_OWNERSHIP_MAP: [],
}));

let testRoot: string;
let tmpWorkspace: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-mat-preflight-skip-"));
  tmpWorkspace = join(testRoot, "workspace");
  mockPipeline.pipelineResult = {
    ok: true,
    steps: [{ ok: true, commandName: "config.regenerate", exitCode: 0 }],
  };
  mockPipeline.pipelineNameUsed = "";
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupWorkspace(): string {
  return createMaterializeWorkspace(testRoot);
}

test("preflight is skipped when state file HEAD matches cache clone HEAD", async () => {
  const systemDir = setupWorkspace();
  const head = gitHead(systemDir);

  // Write state file with matching HEAD
  writeFileSync(
    join(systemDir, ".materialization-state.json"),
    JSON.stringify(
      {
        systemId: "test-system",
        cacheCloneHead: head,
        lastValidatedAt: "2026-07-29T00:00:00Z",
        lastMissionId: "test-system-m000000",
      },
      null,
      2,
    ) + "\n",
  );

  const { runMissionMaterialize } = await import("../mission/mission-materialize.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionMaterialize(input, context);

  expect(expectData(result).preflightSkipped).toBe(true);
  expect(expectData(result).preflightSkipReason).toBe("cache-clone-head-unchanged");
  expect(expectData(result).pipelineUsed).toBe("build.prepare.dev");
  expect(mockPipeline.pipelineNameUsed).toBe("build.prepare.dev");
});

test("preflight runs normally when state file is missing", async () => {
  setupWorkspace();

  const { runMissionMaterialize } = await import("../mission/mission-materialize.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionMaterialize(input, context);

  expect(expectData(result).preflightSkipped).toBe(false);
  expect(expectData(result).preflightSkipReason).toBe(null);
});

test("preflight runs normally when state file HEAD does not match", async () => {
  const systemDir = setupWorkspace();

  // Write state file with non-matching HEAD
  writeFileSync(
    join(systemDir, ".materialization-state.json"),
    JSON.stringify(
      {
        systemId: "test-system",
        cacheCloneHead: "0".repeat(40),
        lastValidatedAt: "2026-07-29T00:00:00Z",
        lastMissionId: "test-system-m000000",
      },
      null,
      2,
    ) + "\n",
  );

  const { runMissionMaterialize } = await import("../mission/mission-materialize.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionMaterialize(input, context);

  expect(expectData(result).preflightSkipped).toBe(false);
  expect(expectData(result).preflightSkipReason).toBe(null);
});

test("preflight runs normally when state file is corrupt", async () => {
  const systemDir = setupWorkspace();

  // Write corrupt state file
  writeFileSync(join(systemDir, ".materialization-state.json"), "{ invalid json }}}");

  const { runMissionMaterialize } = await import("../mission/mission-materialize.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionMaterialize(input, context);

  expect(expectData(result).preflightSkipped).toBe(false);
  expect(expectData(result).preflightSkipReason).toBe(null);
});

test("--skip-preflight flag takes precedence over state file and does not consult it", async () => {
  const systemDir = setupWorkspace();
  const head = gitHead(systemDir);

  // Write state file with matching HEAD
  writeFileSync(
    join(systemDir, ".materialization-state.json"),
    JSON.stringify(
      {
        systemId: "test-system",
        cacheCloneHead: head,
        lastValidatedAt: "2026-07-29T00:00:00Z",
        lastMissionId: "test-system-m000000",
      },
      null,
      2,
    ) + "\n",
  );

  const { runMissionMaterialize } = await import("../mission/mission-materialize.ts");

  const input = {
    flags: { mission: "test-system-m000001", "skip-preflight": true },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionMaterialize(input, context);

  expect(expectData(result).preflightSkipped).toBe(true);
  expect(expectData(result).preflightSkipReason).toBe("operator-override");
});
