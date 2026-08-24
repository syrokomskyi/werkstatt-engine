/*
<MODULE_CONTRACT>
<purpose>RFC-0659: regression tests verifying workpiece artifact cache behavior — cache hit skips build.prepare.dev, --force bypasses cache, cache write on miss, stale state fallback.</purpose>
<keywords>RFC-0659, mission.materialize, artifact cache, cache hit, cache miss, --force, build.prepare.dev skip</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0659: initial tests — cache hit skips build.prepare.dev, --force bypasses cache read, cache write on miss, stale state file fallback.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createMaterializeWorkspace, gitInit, gitCommit } from "./helpers/materialize-fixture.ts";
import { tmpdir } from "node:os";

const mockPipeline = vi.hoisted(() => ({
  forceUsed: undefined as boolean | undefined,
  pipelineNameUsed: "" as string,
  callCount: 0,
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelPipeline: vi.fn(async (opts: { pipelineName: string; force?: boolean }) => {
      mockPipeline.callCount++;
      mockPipeline.pipelineNameUsed = opts.pipelineName;
      mockPipeline.forceUsed = opts.force;
      return [
        {
          ok: true,
          steps: [{ ok: true, commandName: "config.regenerate", exitCode: 0 }],
        },
      ];
    }),
    executeKernelCommand: vi.fn(async () => [{ ok: true, exitCode: 0, summary: "" }]),
    runKernelWire: vi.fn(async () => ({ data: { generated: [] } })),
    resolvePlatformSemanticHash: vi.fn(async () => "sha256:mock-platform-hash"),
  };
});

vi.mock("../handoff/bundle-io.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handoff/bundle-io.ts")>();
  return {
    ...actual,
    resolveCurrentEcosystem: vi.fn(async () => ({
      version: "1.0.0",
      commit: "mock-commit-sha",
    })),
    resolvePlatformSemanticHash: vi.fn(async () => "sha256:mock-platform-hash"),
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
  ensureChromium: vi.fn(async () => {}),
}));

let testRoot: string;
let tmpWorkspace: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-mat-artifact-cache-"));
  tmpWorkspace = join(testRoot, "workspace");
  mockPipeline.forceUsed = undefined;
  mockPipeline.pipelineNameUsed = "";
  mockPipeline.callCount = 0;
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupWorkspace(): string {
  const systemDir = createMaterializeWorkspace(testRoot);
  return systemDir;
}

/**
 * RFC-0659: Create a separate git repo in the system directory so that
 * `resolveCacheCloneHead` returns a stable HEAD independent of the werkstatt repo.
 * The default fixture creates the system dir inside the werkstatt repo, so
 * `git rev-parse HEAD` from the system dir returns the werkstatt HEAD, which
 * changes when `commitWerkstattSideEffects` commits mission.yaml.
 *
 * After git init, we add an uncommitted data-path file so that the workpiece
 * git commit (data-only staging) has something new to commit beyond the cloned
 * history.
 */
function setupWorkspaceWithGitCacheClone(): string {
  const systemDir = setupWorkspace();
  gitInit(systemDir);
  gitCommit(systemDir, "cache clone init");
  // Add an uncommitted file to src/content/ so workpiece git commit has new content
  writeFileSync(
    join(systemDir, "src", "content", "extra.md"),
    "---\ndomain: test\n---\nExtra content\n",
  );
  return systemDir;
}

async function runMaterialize(
  flags: Record<string, unknown> = {},
): Promise<{ data: Record<string, unknown>; summary: string }> {
  const { runMissionMaterialize } = await import("../mission/mission-materialize.ts");
  const input = {
    flags: { mission: "test-system-m000001", ...flags },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;
  return (await runMissionMaterialize(input, context)) as unknown as {
    data: Record<string, unknown>;
    summary: string;
  };
}

test("RFC-0659: cache miss — build.prepare.dev runs, cache entry written, artifactCacheHit=false", async () => {
  setupWorkspaceWithGitCacheClone();

  const result = await runMaterialize();

  expect(mockPipeline.callCount).toBe(1);
  expect(mockPipeline.pipelineNameUsed).toBe("build.prepare.dev");
  expect(mockPipeline.forceUsed).toBe(true);
  expect(result.data.artifactCacheHit).toBe(false);
  expect(result.data.artifactCacheSkipped).toBe(false);
  expect(result.data.artifactCacheKey).toBeTruthy();
});

test("RFC-0659: cache hit — build.prepare.dev skipped, workpiece restored from cache", async () => {
  const systemDir = setupWorkspaceWithGitCacheClone();

  // First materialization — populates cache
  await runMaterialize();

  // Second materialization — should hit cache
  mockPipeline.callCount = 0;
  const result = await runMaterialize();

  expect(mockPipeline.callCount).toBe(0);
  expect(result.data.artifactCacheHit).toBe(true);
  expect(result.data.artifactCacheSkipped).toBe(false);
  expect(result.data.artifactCacheKey).toBeTruthy();

  // Verify state file exists
  const statePath = join(systemDir, ".cache", "materialization-state.json");
  expect(existsSync(statePath)).toBe(true);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  expect(state.systemId).toBe("test-system");
  expect(state.cacheKey).toBe(result.data.artifactCacheKey);
});

test("RFC-0659: --force flag bypasses cache read, build.prepare.dev runs, cache refreshed", async () => {
  const systemDir = setupWorkspaceWithGitCacheClone();

  // First materialization — populates cache
  await runMaterialize();

  // Second materialization with --force — should bypass cache
  mockPipeline.callCount = 0;
  const result = await runMaterialize({ force: true });

  expect(mockPipeline.callCount).toBe(1);
  expect(mockPipeline.pipelineNameUsed).toBe("build.prepare.dev");
  expect(result.data.artifactCacheHit).toBe(false);
  expect(result.data.artifactCacheSkipped).toBe(true);
  expect(result.data.artifactCacheKey).toBeTruthy();

  // Cache state file should be refreshed
  const statePath = join(systemDir, ".cache", "materialization-state.json");
  expect(existsSync(statePath)).toBe(true);
});

test("RFC-0659: stale state file (cache dir missing) — falls through to full materialization", async () => {
  const systemDir = setupWorkspaceWithGitCacheClone();

  // First materialization — populates cache
  await runMaterialize();

  // Delete the cache directory but keep the state file
  const cacheBaseDir = join(systemDir, ".cache", "materialization");
  if (existsSync(cacheBaseDir)) {
    const entries = await import("node:fs/promises").then((m) => m.readdir(cacheBaseDir));
    for (const entry of entries) {
      await import("node:fs/promises").then((m) =>
        m.rm(join(cacheBaseDir, entry), { recursive: true, force: true }),
      );
    }
  }

  // Second materialization — stale state, should fall through
  mockPipeline.callCount = 0;
  const result = await runMaterialize();

  expect(mockPipeline.callCount).toBe(1);
  expect(result.data.artifactCacheHit).toBe(false);
});

test("RFC-0659: .cache/ added to cache clone .gitignore after materialization", async () => {
  const systemDir = setupWorkspaceWithGitCacheClone();

  await runMaterialize();

  const gitignorePath = join(systemDir, ".gitignore");
  expect(existsSync(gitignorePath)).toBe(true);
  const gitignoreContent = readFileSync(gitignorePath, "utf8");
  expect(gitignoreContent).toContain(".cache/");
});

test("RFC-0659: previous cache entry deleted when new entry is written", async () => {
  const systemDir = setupWorkspaceWithGitCacheClone();

  // First materialization
  await runMaterialize();
  const cacheBaseDir = join(systemDir, ".cache", "materialization");
  expect(existsSync(cacheBaseDir)).toBe(true);

  // Simulate a stale entry by creating a fake directory
  const staleDir = join(cacheBaseDir, "stale-entry-hash");
  mkdirSync(staleDir, { recursive: true });
  writeFileSync(join(staleDir, "dummy.txt"), "stale");

  // Second materialization (force to ensure new entry)
  await runMaterialize({ force: true });

  // Stale entry should be deleted
  expect(existsSync(staleDir)).toBe(false);
});

test("RFC-0659: report-only mode does not touch artifact cache", async () => {
  setupWorkspaceWithGitCacheClone();

  const result = await runMaterialize({ "report-only": true });

  expect(result.data.artifactCacheHit).toBe(false);
  expect(result.data.artifactCacheKey).toBe(null);
  expect(result.data.artifactCacheSkipped).toBe(false);
  expect(mockPipeline.callCount).toBe(0);
});
