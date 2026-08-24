/*
<MODULE_CONTRACT>
<purpose>RFC-0594: unit and integration tests for pre-commit content validation in mission.git.commit.</purpose>
<keywords>RFC-0594, mission.git.commit, pre-commit, validation, gate, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0594: initial unit and integration tests for runPreCommitValidation and mission.git.commit gate.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";

const mockState = vi.hoisted(() => ({
  validatorResults: {} as Record<string, { ok: boolean; exitCode: number; summary: string }>,
  throwOnValidator: null as string | null,
  throwNotRegistered: null as string | null,
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(async (options: { commandName: string }) => {
      const name = options.commandName;
      if (mockState.throwNotRegistered === name) {
        throw new Error(`Command '${name}' is not registered`);
      }
      if (mockState.throwOnValidator === name) {
        throw new Error(`validator crashed unexpectedly`);
      }
      const result = mockState.validatorResults[name];
      if (!result) {
        return { ok: true, exitCode: 0, summary: "", data: null };
      }
      return result;
    }),
  };
});

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function _gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let tmpWorkspace: string;

beforeEach(() => {
  tmpWorkspace = mkdtempSync(join(tmpdir(), "tmp-git-commit-validation-"));
  mockState.validatorResults = {};
  mockState.throwOnValidator = null;
  mockState.throwNotRegistered = null;
});

afterEach(() => {
  rmSync(tmpWorkspace, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Unit tests — test runPreCommitValidation directly
// ---------------------------------------------------------------------------

test("no content files changed — no validators run", async () => {
  const { runPreCommitValidation } = await import("../mission/mission-git-commit.ts");
  const result = await runPreCommitValidation(
    ["astro.config.mjs", "package.json"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(true);
  expect(result.validatorsRun).toEqual([]);
  expect(result.failures).toEqual([]);
});

test("prefix matching — business-profile and pages trigger correct validators", async () => {
  const { runPreCommitValidation } = await import("../mission/mission-git-commit.ts");
  mockState.validatorResults = {
    "pbp.content.validate": { ok: true, exitCode: 0, summary: "pass" },
    "semantic.drift.validate": { ok: true, exitCode: 0, summary: "pass" },
  };
  const result = await runPreCommitValidation(
    ["src/content/business-profile/de/offerings/automation.md", "src/content/pages/de/index.md"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(true);
  expect(result.validatorsRun).toContain("pbp.content.validate");
  expect(result.validatorsRun).toContain("semantic.drift.validate");
  expect(result.validatorsRun).toHaveLength(2);
});

test("unregistered validator — skipped with warning, commit proceeds", async () => {
  const { runPreCommitValidation } = await import("../mission/mission-git-commit.ts");
  mockState.throwNotRegistered = "faq.validate";
  const result = await runPreCommitValidation(
    ["src/content/faq/de/general.md"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(true);
  expect(result.validatorsRun).toEqual([]);
  expect(result.failures).toEqual([]);
});

test("validator fails — passed is false, failure recorded with files", async () => {
  const { runPreCommitValidation } = await import("../mission/mission-git-commit.ts");
  mockState.validatorResults = {
    "pbp.content.validate": {
      ok: false,
      exitCode: 1,
      summary: "10 file(s) with schema violations",
    },
  };
  const result = await runPreCommitValidation(
    ["src/content/business-profile/de/offerings/automation.md"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(false);
  expect(result.failures).toHaveLength(1);
  expect(result.failures[0].validator).toBe("pbp.content.validate");
  expect(result.failures[0].message).toContain("schema violations");
  expect(result.failures[0].files).toEqual([
    "src/content/business-profile/de/offerings/automation.md",
  ]);
});

// ---------------------------------------------------------------------------
// Integration tests — test through runMissionGitCommit with real git workpiece
// ---------------------------------------------------------------------------

function setupWorkpiece(): string {
  gitInit(tmpWorkspace);

  mkdirSync(join(tmpWorkspace, "systems"), { recursive: true });
  const registryContent = `schemaVersion: "1.0.0"
systems:
  - id: test-system
    cosmicStar: Vega
    mirrors:
      - path: "./systems/test-system"
        storageType: non-bare
    pinnedPlatform: "4.5.0"
    currentMission: test-system-m000001
    lastRelease: null
    status: active
    registeredAt: "2026-01-01T00:00:00Z"
    notes: ""
`;
  writeFileSync(join(tmpWorkspace, "systems", "registry.yaml"), registryContent);

  mkdirSync(join(tmpWorkspace, "systems", "test-system"), { recursive: true });
  writeFileSync(
    join(tmpWorkspace, "systems", "test-system", "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );
  mkdirSync(join(tmpWorkspace, "systems", "test-system", "bordbuch"), { recursive: true });

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
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
    materializedAt: "2026-07-30T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: null,
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  // Set up workpiece as a git repo with initial content
  const workpieceDir = join(missionDir, "workpiece");
  gitInit(workpieceDir);
  writeFileSync(join(workpieceDir, "README.md"), "# initial\n");
  execSync("git add -A", { cwd: workpieceDir, stdio: "pipe" });
  execSync('git commit -m "initial"', { cwd: workpieceDir, stdio: "pipe" });

  return workpieceDir;
}

test("validator fails — commit blocked, no new commit in git log", async () => {
  const workpieceDir = setupWorkpiece();

  // Add a content file that triggers pbp.content.validate
  mkdirSync(join(workpieceDir, "src", "content", "business-profile", "de", "offerings"), {
    recursive: true,
  });
  writeFileSync(
    join(workpieceDir, "src", "content", "business-profile", "de", "offerings", "automation.md"),
    "invalid content",
  );

  mockState.validatorResults = {
    "pbp.content.validate": {
      ok: false,
      exitCode: 1,
      summary: "schema violation: wrong field name",
    },
  };

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");

  const input = {
    flags: { mission: "test-system-m000001", message: "add offering" },
  } as unknown as KernelCommandInput;
  const context = { workspaceRoot: tmpWorkspace } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);
  expect(result.exitCode).toBe(1);
  expect(result.data?.preCommitValidation?.passed).toBe(false);
  expect(result.data?.preCommitValidation?.failures).toHaveLength(1);
  expect(result.data?.preCommitValidation?.failures[0].validator).toBe("pbp.content.validate");

  // No new commit should exist — only the initial commit
  const logOutput = execSync("git log --oneline", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  const logLines = logOutput.split("\n");
  expect(logLines).toHaveLength(1);
  expect(logLines[0]).toContain("initial");
});

test("no content files — no validators run, commit succeeds", async () => {
  const workpieceDir = setupWorkpiece();

  // Add a non-content file
  writeFileSync(join(workpieceDir, "astro.config.mjs"), "// updated config\n");

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");

  const input = {
    flags: { mission: "test-system-m000001", message: "update config" },
  } as unknown as KernelCommandInput;
  const context = { workspaceRoot: tmpWorkspace } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);
  expect(result.exitCode ?? 0).toBe(0);
  expect(result.data?.commitSha).toBeTruthy();
  expect(result.data?.preCommitValidation?.passed).toBe(true);
  expect(result.data?.preCommitValidation?.validatorsRun).toEqual([]);

  // New commit should exist
  const logOutput = execSync("git log --oneline", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  expect(logOutput).toContain("update config");
});

test("staged changes preserved on validation failure", async () => {
  const workpieceDir = setupWorkpiece();

  // Add a content file
  mkdirSync(join(workpieceDir, "src", "content", "business-profile", "de"), { recursive: true });
  writeFileSync(
    join(workpieceDir, "src", "content", "business-profile", "de", "offerings.md"),
    "invalid",
  );

  mockState.validatorResults = {
    "pbp.content.validate": { ok: false, exitCode: 1, summary: "fail" },
  };

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");

  const input = {
    flags: { mission: "test-system-m000001", message: "add offering" },
  } as unknown as KernelCommandInput;
  const context = { workspaceRoot: tmpWorkspace } as unknown as KernelRuntimeContext;

  await runMissionGitCommit(input, context);

  // Files should still be staged (git status --porcelain shows them)
  const statusOutput = execSync("git status --porcelain", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  expect(statusOutput).toContain("src/content/business-profile/de/offerings.md");
});
