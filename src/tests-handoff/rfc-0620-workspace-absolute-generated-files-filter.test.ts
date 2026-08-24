/*
<MODULE_CONTRACT>
<purpose>RFC-0620: regression tests verifying workspace-absolute generated files are filtered from mission materialization data-path copy.</purpose>
<keywords>RFC-0620, mission.materialize, ownership map, workspace-absolute, generated files, filter</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0620: initial regression tests — bordbuch files filtered, mock entry filtered, authored files preserved.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createMaterializeWorkspace } from "./helpers/materialize-fixture.ts";
import { tmpdir } from "node:os";

const mockPipeline = vi.hoisted(() => ({
  pipelineResult: {
    ok: true,
    steps: [{ ok: true, commandName: "config.regenerate", exitCode: 0 }],
  },
}));

const mockOwnershipMap = vi.hoisted(() => [
  // Real bordbuch entries (matching GENERATOR_OWNERSHIP_MAP)
  {
    path: "systems/{system}/public/.well-known/bordbuch.json",
    command: "bordbuch.generate",
    markerPolicy: "registry-only",
    module: "packages/os/site-kernel-handoff/src/bordbuch/bordbuch-generate.ts",
  },
  {
    path: "systems/{system}/public/.well-known/bordbuch/index.html",
    command: "bordbuch.generate",
    markerPolicy: "registry-only",
    module: "packages/os/site-kernel-handoff/src/bordbuch/bordbuch-generate.ts",
  },
  // Mock entry — a hypothetical workspace-absolute generator
  {
    path: "systems/{system}/public/test-generated.json",
    command: "test.generate",
    markerPolicy: "registry-only",
    module: "packages/os/test/src/test-generate.ts",
  },
]);

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelPipeline: vi.fn(async () => [mockPipeline.pipelineResult]),
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
}));

vi.mock("@warpgogol/werkstatt-site/checks", () => ({
  runEnvExampleGenerate: vi.fn(async () => []),
  MISSION_PREFLIGHT_CRITICAL: [],
  MISSION_PREFLIGHT_WARNING: [],
  GENERATOR_OWNERSHIP_MAP: mockOwnershipMap,
  ensureChromium: vi.fn(async () => ({ ok: true, path: "/usr/bin/chromium", version: "1.0" })),
}));

let testRoot: string;
let tmpWorkspace: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rfc-0620-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupWorkspaceWithGeneratedFiles(): string {
  const systemDir = createMaterializeWorkspace(testRoot);

  // Add bordbuch generated files to cache clone's public/
  const wellKnownDir = join(systemDir, "public", ".well-known");
  mkdirSync(wellKnownDir, { recursive: true });
  writeFileSync(join(wellKnownDir, "bordbuch.json"), '{"test":true}');
  mkdirSync(join(wellKnownDir, "bordbuch"), { recursive: true });
  writeFileSync(join(wellKnownDir, "bordbuch", "index.html"), "<html>bordbuch</html>");

  // Add mock workspace-absolute generated file
  writeFileSync(join(systemDir, "public", "test-generated.json"), '{"mock":true}');

  // Add authored files that should be preserved
  mkdirSync(join(systemDir, "public", "textures"), { recursive: true });
  writeFileSync(join(systemDir, "public", "textures", "logo.svg"), "<svg>logo</svg>");
  writeFileSync(join(systemDir, "public", "favicon.ico"), "fake-icon");

  // Commit the new files to the cache clone
  execSync("git add -A && git commit -m add-generated", {
    cwd: testRoot,
    stdio: "pipe",
  });

  return systemDir;
}

async function materializeAndGetWorkpiecePublic(): Promise<string> {
  setupWorkspaceWithGeneratedFiles();

  const { runMissionMaterialize } = await import("../mission/mission-materialize.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;

  await runMissionMaterialize(input, context);

  return join(tmpWorkspace, "missions", "test-system-m000001", "workpiece", "public");
}

test("RFC-0620: workspace-absolute generated files are filtered from workpiece public/", async () => {
  const workpiecePublic = await materializeAndGetWorkpiecePublic();

  // Bordbuch files must NOT exist in workpiece
  expect(existsSync(join(workpiecePublic, ".well-known", "bordbuch.json"))).toBe(false);
  expect(existsSync(join(workpiecePublic, ".well-known", "bordbuch", "index.html"))).toBe(false);
  // Mock generated file must NOT exist — proves filter reads from GENERATOR_OWNERSHIP_MAP,
  // not from a hardcoded list of bordbuch paths
  expect(existsSync(join(workpiecePublic, "test-generated.json"))).toBe(false);
});

test("RFC-0620: authored files in public/ are preserved in workpiece", async () => {
  const workpiecePublic = await materializeAndGetWorkpiecePublic();

  // Authored files MUST exist in workpiece
  expect(existsSync(join(workpiecePublic, "textures", "logo.svg"))).toBe(true);
  expect(existsSync(join(workpiecePublic, "favicon.ico"))).toBe(true);
});
