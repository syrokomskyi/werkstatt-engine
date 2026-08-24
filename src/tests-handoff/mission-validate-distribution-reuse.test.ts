/*
<MODULE_CONTRACT>
<purpose>RFC-0635: unit tests for distribution reuse in mission.validate when build-input-hash matches.</purpose>
<keywords>RFC-0635, mission.validate, distribution reuse, build-input-hash, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0635: initial tests for distribution reuse paths in mission.validate.</item>
  <item>RFC-0702: add test verifying commitBordbuchProjections is called in the reuse path.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";
import { tmpdir } from "node:os";

const mockPipeline = vi.hoisted(() => ({
  prepareResult: { ok: true, steps: [{ ok: true, commandName: "config.regenerate", exitCode: 0 }] },
  checkResult: { ok: true, steps: [{ ok: true, commandName: "content.validate", exitCode: 0 }] },
  postResult: { ok: true, steps: [{ ok: true, commandName: "text.normalize.apply", exitCode: 0 }] },
  execSyncCalled: false,
  computeHash: "sha256:matching-hash",
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelPipeline: vi.fn(async (opts: { pipelineName: string }) => {
      if (opts.pipelineName === "build.prepare") return [mockPipeline.prepareResult] as never;
      if (opts.pipelineName === "build.check") return [mockPipeline.checkResult] as never;
      if (opts.pipelineName === "build.post") return [mockPipeline.postResult] as never;
      return [{ ok: true, steps: [] }] as never;
    }),
    executeKernelCommand: vi.fn(async () => [{ ok: true, exitCode: 0, summary: "" }] as never),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn((cmd: string, opts?: Record<string, unknown>) => {
      if (cmd === "pnpm exec astro build") {
        mockPipeline.execSyncCalled = true;
        return "10 page(s)";
      }
      return actual.execSync(cmd, opts as never);
    }),
  };
});

vi.mock("../handoff/build-pipeline-helpers.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handoff/build-pipeline-helpers.ts")>();
  return {
    ...actual,
    computeBuildInputHash: vi.fn(async () => ({
      buildInputHash: mockPipeline.computeHash,
      workpieceTreeHash: "sha256:tree",
      platformVersion: "1.0.0",
      platformSemanticHash: "sha256:platform",
    })),
  };
});

const bordbuchCommitMock = vi.hoisted(() => ({
  called: false,
  result: {
    committed: false as boolean,
    commitSha: null as string | null,
    systemId: "test-system" as string,
    filesCommitted: [] as string[],
  },
}));

vi.mock("../bordbuch/bordbuch-commit.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bordbuch/bordbuch-commit.ts")>();
  return {
    ...actual,
    commitBordbuchProjections: vi.fn(async () => {
      bordbuchCommitMock.called = true;
      return bordbuchCommitMock.result;
    }),
  };
});

function gitInit(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let tmpWorkspace: string;

beforeEach(() => {
  tmpWorkspace = mkdtempSync(join(tmpdir(), "tmp-validate-reuse-"));
  mockPipeline.execSyncCalled = false;
  mockPipeline.computeHash = "sha256:matching-hash";
  bordbuchCommitMock.called = false;
  bordbuchCommitMock.result = {
    committed: false,
    commitSha: null,
    systemId: "test-system",
    filesCommitted: [],
  } as const;
});

afterEach(() => {
  rmSync(tmpWorkspace, { recursive: true, force: true });
});

function setupWorkspace(): string {
  gitInit(tmpWorkspace);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  writeFileSync(join(tmpWorkspace, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  writeFileSync(join(tmpWorkspace, "pnpm-workspace.yaml"), "packages: []\n");
  gitCommit(tmpWorkspace, "initial");

  mkdirSync(join(tmpWorkspace, "systems"), { recursive: true });
  const registryContent = `schemaVersion: "1.0.0"
systems:
  - id: test-system
    cosmicStar: Vega
    mirrors:
      - path: "./systems/test-system"
        storageType: non-bare
    pinnedPlatform: "1.0.0"
    currentMission: test-system-m000001
    lastRelease: null
    status: active
    registeredAt: "2026-01-01T00:00:00Z"
    notes: ""
`;
  writeFileSync(join(tmpWorkspace, "systems", "registry.yaml"), registryContent);
  gitCommit(tmpWorkspace, "add registry");

  const systemDir = join(tmpWorkspace, "systems", "test-system");
  mkdirSync(systemDir, { recursive: true });
  writeFileSync(
    join(systemDir, "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );
  mkdirSync(join(systemDir, "bordbuch"), { recursive: true });
  writeFileSync(join(systemDir, "bordbuch", "events.ndjson"), "");
  mkdirSync(join(systemDir, "src", "content"), { recursive: true });
  writeFileSync(
    join(systemDir, "src", "content", "system.md"),
    "---\n  domain: test\n  i18n:\n    default: de\n    languages:\n      - de\n---\n",
  );
  gitCommit(tmpWorkspace, "add system");

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  const workpieceDir = join(missionDir, "workpiece");
  mkdirSync(workpieceDir, { recursive: true });
  mkdirSync(join(missionDir, "evidence"), { recursive: true });

  gitInit(workpieceDir);
  writeFileSync(
    join(workpieceDir, "system.md"),
    "---\ni18n:\n  default: de\n  languages:\n  - de\n---\n",
  );
  gitCommit(workpieceDir, "initial workpiece");

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
    materializedAt: "2026-07-30T00:00:00.000Z",
    migratedAt: null,
    reconciledAt: null,
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  return workpieceDir;
}

function writeDistributionHash(missionDir: string, hash: string): void {
  const distributionDir = join(missionDir, "distribution");
  mkdirSync(distributionDir, { recursive: true });
  writeFileSync(
    join(distributionDir, "build-input-hash.json"),
    JSON.stringify({ buildInputHash: hash, computedAt: "2026-07-30T00:00:00.000Z" }, null, 2) +
      "\n",
  );
}

function writeDistributionDist(missionDir: string, routeCount = 5): void {
  const distributionDir = join(missionDir, "distribution");
  const distDir = join(distributionDir, "dist");
  mkdirSync(join(distDir, "client"), { recursive: true });
  writeFileSync(join(distDir, "client", "index.html"), "<html>reused</html>");
  writeFileSync(
    join(distributionDir, "build-manifest.json"),
    JSON.stringify({ routeCount, sitemapHash: "sha256:reused-sitemap", succeeded: true }, null, 2) +
      "\n",
  );
}

function makeInput(flags: Record<string, unknown> = {}): KernelCommandInput {
  return {
    flags: { mission: "test-system-m000001", ...flags },
    argv: [],
  };
}

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;
}

test("hash match → build cycle skipped, distributionReused: true", async () => {
  const _workpieceDir = setupWorkspace();
  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  writeDistributionHash(missionDir, "sha256:matching-hash");
  writeDistributionDist(missionDir, 7);

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(result.summary).toContain("distribution reused");
  expect(result.summary).toContain("passed");
  expect(expectData(result).distributionReused).toBe(true);
  expect(expectData(result).fullBuildRan).toBe(false);
  expect(expectData(result).buildInputHash).toBe("sha256:matching-hash");
  expect(mockPipeline.execSyncCalled).toBe(false);
});

test("hash mismatch → full build cycle runs, distributionReused: false", async () => {
  setupWorkspace();
  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  writeDistributionHash(missionDir, "sha256:different-hash");
  writeDistributionDist(missionDir);

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(result.summary).toContain("passed");
  expect(expectData(result).distributionReused).toBe(false);
  expect(expectData(result).fullBuildRan).toBe(true);
  expect(expectData(result).buildInputHash).toBeNull();
  expect(mockPipeline.execSyncCalled).toBe(true);
});

test("--force → full build cycle runs regardless of hash match", async () => {
  setupWorkspace();
  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  writeDistributionHash(missionDir, "sha256:matching-hash");
  writeDistributionDist(missionDir);

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput({ force: true }), makeContext());

  expect(result.summary).toContain("passed");
  expect(expectData(result).distributionReused).toBe(false);
  expect(expectData(result).fullBuildRan).toBe(true);
  expect(mockPipeline.execSyncCalled).toBe(true);
});

test("distribution/ missing → full build runs, distributionReused: false", async () => {
  setupWorkspace();

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(result.summary).toContain("passed");
  expect(expectData(result).distributionReused).toBe(false);
  expect(expectData(result).fullBuildRan).toBe(true);
  expect(mockPipeline.execSyncCalled).toBe(true);
});

test("build-input-hash.json corrupt → full build runs, distributionReused: false", async () => {
  setupWorkspace();
  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  const distributionDir = join(missionDir, "distribution");
  mkdirSync(distributionDir, { recursive: true });
  mkdirSync(join(distributionDir, "dist", "client"), { recursive: true });
  writeFileSync(join(distributionDir, "dist", "client", "index.html"), "<html></html>");
  writeFileSync(join(distributionDir, "build-input-hash.json"), "NOT VALID JSON{{{");

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(result.summary).toContain("passed");
  expect(expectData(result).distributionReused).toBe(false);
  expect(expectData(result).fullBuildRan).toBe(true);
  expect(mockPipeline.execSyncCalled).toBe(true);
});

test("hash matches but distribution/dist/ missing → full build runs", async () => {
  setupWorkspace();
  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  writeDistributionHash(missionDir, "sha256:matching-hash");
  // Don't create distribution/dist/

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(result.summary).toContain("passed");
  expect(expectData(result).distributionReused).toBe(false);
  expect(expectData(result).fullBuildRan).toBe(true);
  expect(mockPipeline.execSyncCalled).toBe(true);
});

test("hash match copies distribution/dist/ to workpiece/dist/ when missing", async () => {
  const workpieceDir = setupWorkspace();
  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  writeDistributionHash(missionDir, "sha256:matching-hash");
  writeDistributionDist(missionDir, 3);

  expect(existsSync(join(workpieceDir, "dist"))).toBe(false);

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  await runMissionValidate(makeInput(), makeContext());

  expect(existsSync(join(workpieceDir, "dist", "client", "index.html"))).toBe(true);
});

// RFC-0702: reuse path calls commitBordbuchProjections for cleanup

test("reuse path calls commitBordbuchProjections for bordbuch cleanup", async () => {
  setupWorkspace();
  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  writeDistributionHash(missionDir, "sha256:matching-hash");
  writeDistributionDist(missionDir, 5);

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  await runMissionValidate(makeInput(), makeContext());

  expect(bordbuchCommitMock.called).toBe(true);
});

test("reuse path logs bordbuch cleanup when commitBordbuchProjections commits files", async () => {
  setupWorkspace();
  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  writeDistributionHash(missionDir, "sha256:matching-hash");
  writeDistributionDist(missionDir, 5);
  bordbuchCommitMock.result = {
    committed: true,
    commitSha: "abc123",
    systemId: "test-system",
    filesCommitted: ["bordbuch/status.generated.yaml"],
  };

  const infoCalls: unknown[] = [];
  const ctx = {
    workspaceRoot: tmpWorkspace,
    logger: {
      info: (...args: unknown[]) => infoCalls.push(args.join(" ")),
      warn: () => {},
      error: () => {},
    },
  } as unknown as KernelRuntimeContext;

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  await runMissionValidate(makeInput(), ctx);

  expect(bordbuchCommitMock.called).toBe(true);
  expect(infoCalls.some((m) => String(m).includes("Bordbuch auto-commit"))).toBe(true);
});

test("reuse path continues when commitBordbuchProjections throws", async () => {
  setupWorkspace();
  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  writeDistributionHash(missionDir, "sha256:matching-hash");
  writeDistributionDist(missionDir, 5);

  vi.mocked(
    await import("../bordbuch/bordbuch-commit.ts").then((m) => m.commitBordbuchProjections),
  ).mockRejectedValueOnce(new Error("unexpected git failure"));

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(result.summary).toContain("distribution reused");
  expect(result.summary).toContain("passed");
});
