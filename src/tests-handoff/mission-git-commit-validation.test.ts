/*
<MODULE_CONTRACT>
<purpose>RFC-0594: unit and integration tests for pre-commit content validation in mission.git.commit.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0096: bootstrap committed behavior snapshot before build.post</item>
  <item>RFC-1160: commit-gate validators (page.block.validate + image.variants.validate scoped mode, IMG-VARIANT-SRC rules, any-unscoped-wins scope resolution)</item>
  <item>RFC-1185: shared.context.validate joins the pages/system.md prefix mapping — prefix-matching test updated for the sixth validator</item>
  <item>RFC-1199: MATERIALIZATION_IN_PROGRESS guard tests — sentinel blocks, materializedAt-null fallback blocks, guard precedes .git check</item>
  <item>RFC-1204: trigger effects.contract.validate unscoped on pages/prose staging</item>
  <history>RFC-0594, RFC-1095</history>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

const mockState = vi.hoisted(() => ({
  validatorResults: {} as Record<string, { ok: boolean; exitCode: number; summary: string }>,
  validatorArgv: {} as Record<string, string[] | undefined>,
  throwOnValidator: null as string | null,
  throwNotRegistered: null as string | null,
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(async (options: { commandName: string; argv?: string[] }) => {
      const name = options.commandName;
      mockState.validatorArgv[name] = options.argv;
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
  mockState.validatorArgv = {};
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
    "page.block.validate": { ok: true, exitCode: 0, summary: "pass" },
    "semantic.drift.validate": { ok: true, exitCode: 0, summary: "pass" },
    "image.variants.validate": { ok: true, exitCode: 0, summary: "pass" },
    "typography.validate": { ok: true, exitCode: 0, summary: "pass" },
    "shared.context.validate": { ok: true, exitCode: 0, summary: "pass" },
    "effects.contract.validate": { ok: true, exitCode: 0, summary: "pass" },
    "layout.rhythm.validate": { ok: true, exitCode: 0, summary: "pass" },
  };
  const result = await runPreCommitValidation(
    ["src/content/business-profile/de/offerings/automation.md", "src/content/pages/de/index.md"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(true);
  expect(result.validatorsRun).toContain("pbp.content.validate");
  expect(result.validatorsRun).toContain("page.block.validate");
  expect(result.validatorsRun).toContain("semantic.drift.validate");
  expect(result.validatorsRun).toContain("image.variants.validate");
  expect(result.validatorsRun).toContain("typography.validate");
  // RFC-1185: pages/ commits also trigger the explicit-inherit-edge validator.
  expect(result.validatorsRun).toContain("shared.context.validate");
  // RFC-1204: pages/ commits trigger the unscoped effect-signature parity check.
  expect(result.validatorsRun).toContain("effects.contract.validate");
  // warpgogol-m000196: pages/ commits trigger the unscoped post-hero rhythm check.
  expect(result.validatorsRun).toContain("layout.rhythm.validate");
  expect(result.validatorsRun).toHaveLength(8);
});

test("unregistered validator — skipped with warning, commit proceeds", async () => {
  const { runPreCommitValidation } = await import("../mission/mission-git-commit.ts");
  mockState.throwNotRegistered = "faq.validate";
  mockState.validatorResults = {
    "typography.validate": { ok: true, exitCode: 0, summary: "pass" },
    "image.variants.validate": { ok: true, exitCode: 0, summary: "pass" },
  };
  const result = await runPreCommitValidation(
    ["src/content/faq/de/general.md"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(true);
  expect(result.validatorsRun).toEqual(["image.variants.validate", "typography.validate"]);
  expect(result.failures).toEqual([]);
});

// ---------------------------------------------------------------------------
// RFC-1160 — commit-gate validators: block pinning + source-budget scoping
// ---------------------------------------------------------------------------

test("page.block.validate runs scoped when only pages files are staged (AC-1 path)", async () => {
  const { runPreCommitValidation } = await import("../mission/mission-git-commit.ts");
  mockState.validatorResults = {
    "page.block.validate": { ok: true, exitCode: 0, summary: "pass" },
    "semantic.drift.validate": { ok: true, exitCode: 0, summary: "pass" },
    "image.variants.validate": { ok: true, exitCode: 0, summary: "pass" },
    "typography.validate": { ok: true, exitCode: 0, summary: "pass" },
  };
  const result = await runPreCommitValidation(
    ["src/content/pages/de/agb.md"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(true);
  expect(result.validatorsRun).toContain("page.block.validate");
  expect(mockState.validatorArgv["page.block.validate"]).toEqual([
    "--scope-files",
    "src/content/pages/de/agb.md",
  ]);
});

test("page.block.validate failure is reported through preCommitValidation.failures (AC-1)", async () => {
  const { runPreCommitValidation } = await import("../mission/mission-git-commit.ts");
  mockState.validatorResults = {
    "page.block.validate": {
      ok: false,
      exitCode: 1,
      summary: "B-02: block hero on page de/agb is not pinned in system.md planets[]",
    },
    "semantic.drift.validate": { ok: true, exitCode: 0, summary: "pass" },
    "image.variants.validate": { ok: true, exitCode: 0, summary: "pass" },
    "typography.validate": { ok: true, exitCode: 0, summary: "pass" },
  };
  const result = await runPreCommitValidation(
    ["src/content/pages/de/agb.md"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(false);
  const failure = result.failures.find((f) => f.validator === "page.block.validate");
  expect(failure, "B-02 failure must surface in preCommitValidation.failures").toBeTruthy();
  expect(failure?.files).toEqual(["src/content/pages/de/agb.md"]);
});

test("system.md alone runs page.block.validate UNSCOPED (AC-2)", async () => {
  const { runPreCommitValidation } = await import("../mission/mission-git-commit.ts");
  mockState.validatorResults = {
    "page.block.validate": { ok: true, exitCode: 0, summary: "pass" },
    "image.variants.validate": { ok: true, exitCode: 0, summary: "pass" },
    "typography.validate": { ok: true, exitCode: 0, summary: "pass" },
  };
  const result = await runPreCommitValidation(
    ["src/content/system.md"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(true);
  expect(result.validatorsRun).toContain("page.block.validate");
  expect(
    mockState.validatorArgv["page.block.validate"],
    "system.md planets[] mapping is unscoped — argv must omit --scope-files",
  ).toBeUndefined();
});

test("mixed system.md + pages commit runs page.block.validate UNSCOPED (AC-9, any-unscoped-wins)", async () => {
  const { runPreCommitValidation } = await import("../mission/mission-git-commit.ts");
  mockState.validatorResults = {
    "page.block.validate": { ok: true, exitCode: 0, summary: "pass" },
    "semantic.drift.validate": { ok: true, exitCode: 0, summary: "pass" },
    "image.variants.validate": { ok: true, exitCode: 0, summary: "pass" },
    "typography.validate": { ok: true, exitCode: 0, summary: "pass" },
  };
  const result = await runPreCommitValidation(
    ["src/content/system.md", "src/content/pages/de/agb.md"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(true);
  expect(
    mockState.validatorArgv["page.block.validate"],
    "mixed commit with system.md must force an unscoped page.block.validate",
  ).toBeUndefined();
});

test("pages commit runs effects.contract.validate UNSCOPED (RFC-1204 AC-6)", async () => {
  const { runPreCommitValidation } = await import("../mission/mission-git-commit.ts");
  mockState.validatorResults = {
    "page.block.validate": { ok: true, exitCode: 0, summary: "pass" },
    "semantic.drift.validate": { ok: true, exitCode: 0, summary: "pass" },
    "image.variants.validate": { ok: true, exitCode: 0, summary: "pass" },
    "typography.validate": { ok: true, exitCode: 0, summary: "pass" },
    "shared.context.validate": { ok: true, exitCode: 0, summary: "pass" },
    "effects.contract.validate": { ok: true, exitCode: 0, summary: "pass" },
  };
  const result = await runPreCommitValidation(
    ["src/content/pages/de/agb.md"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(true);
  expect(result.validatorsRun).toContain("effects.contract.validate");
  expect(
    mockState.validatorArgv["effects.contract.validate"],
    "effect-signature parity is cross-page/cross-locale — argv must omit --scope-files",
  ).toBeUndefined();
});

test("content asset triggers image.variants.validate scoped to the staged files", async () => {
  const { runPreCommitValidation } = await import("../mission/mission-git-commit.ts");
  mockState.validatorResults = {
    "image.variants.validate": { ok: true, exitCode: 0, summary: "pass" },
    "typography.validate": { ok: true, exitCode: 0, summary: "pass" },
  };
  const result = await runPreCommitValidation(
    ["src/content/pages/de/assets/hero.webp"],
    "test-system",
    tmpWorkspace,
  );
  expect(result.passed).toBe(true);
  expect(result.validatorsRun).toContain("image.variants.validate");
  expect(mockState.validatorArgv["image.variants.validate"]).toEqual([
    "--scope-files",
    "src/content/pages/de/assets/hero.webp",
  ]);
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

function setupWorkpiece(options: { materializedAt?: string | null } = {}): string {
  const { materializedAt = "2026-07-30T01:00:00.000Z" } = options;
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
    materializedAt,
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
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

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
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

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

test("ADR-0096: --scope-files stages only listed paths, unstaged content cannot block the commit", async () => {
  const workpieceDir = setupWorkpiece();

  // Bookkeeping target plus an unrelated dirty content file that maps to
  // validators — those validators are configured to fail to prove the scoped
  // commit is not blocked by unrelated dirty content.
  writeFileSync(join(workpieceDir, "behavior.snapshot.generated.yaml"), "generated: true\n");
  mkdirSync(join(workpieceDir, "src", "content", "pages", "de"), { recursive: true });
  writeFileSync(join(workpieceDir, "src", "content", "pages", "de", "broken.md"), "bad\n");

  mockState.validatorResults = {
    "semantic.drift.validate": { ok: false, exitCode: 1, summary: "drift" },
    "typography.validate": { ok: false, exitCode: 1, summary: "typo" },
  };

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");
  const input = {
    flags: {
      mission: "test-system-m000001",
      message: "chore: bootstrap committed behavior snapshot",
      "scope-files": "behavior.snapshot.generated.yaml",
    },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);
  expect(result.exitCode ?? 0).toBe(0);
  expect(
    result.data?.preCommitValidation?.validatorsRun,
    "Scoped commit must not run validators for files it does not commit",
  ).toEqual([]);

  // Only the snapshot file entered the commit; the dirty content file stays
  // untracked.
  const committedFiles = execSync("git show --name-only --format= HEAD", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  expect(committedFiles).toBe("behavior.snapshot.generated.yaml");

  const status = execSync("git status --porcelain", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  // git collapses a fully-untracked directory — the whole src/ tree stays
  // unstaged, proving the scoped commit did not sweep unrelated content.
  expect(status).toContain("?? src/");
});

test("ADR-0104: --scope-files commits only named paths — staged residue is neither swept nor validated", async () => {
  const workpieceDir = setupWorkpiece();

  // Reproduce m000164: bookkeeping target + STAGED operator content whose
  // validators are configured to fail — under the old index-wide diff the
  // residue both blocked validation and rode into the commit object.
  writeFileSync(join(workpieceDir, "behavior.snapshot.generated.yaml"), "generated: true\n");
  mkdirSync(join(workpieceDir, "src", "content", "pages", "de"), { recursive: true });
  writeFileSync(join(workpieceDir, "src", "content", "pages", "de", "broken.md"), "bad\n");
  execSync("git add src/content/pages/de/broken.md", { cwd: workpieceDir, stdio: "pipe" });

  mockState.validatorResults = {
    "page.block.validate": { ok: false, exitCode: 1, summary: "B-02" },
    "semantic.drift.validate": { ok: false, exitCode: 1, summary: "drift" },
    "image.variants.validate": { ok: false, exitCode: 1, summary: "variants" },
    "typography.validate": { ok: false, exitCode: 1, summary: "typo" },
  };

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");
  const input = {
    flags: {
      mission: "test-system-m000001",
      message: "chore: bootstrap committed behavior snapshot",
      "scope-files": "behavior.snapshot.generated.yaml",
    },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);
  expect(result.exitCode ?? 0).toBe(0);
  expect(
    result.data?.preCommitValidation?.validatorsRun,
    "Scoped stagedFiles must exclude residue — no validators may run",
  ).toEqual([]);

  const committedFiles = execSync("git show --name-only --format= HEAD", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  expect(committedFiles, "Scoped commit object must contain exactly the named path").toBe(
    "behavior.snapshot.generated.yaml",
  );

  // Residue stays staged, untouched.
  const status = execSync("git status --porcelain", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  expect(status).toBe("A  src/content/pages/de/broken.md");
});

test("ADR-0104: --scope-files with only residue staged reports noChanges instead of committing residue", async () => {
  const workpieceDir = setupWorkpiece();

  // Stage residue outside the scope; README.md (scoped) is unchanged.
  writeFileSync(join(workpieceDir, "residue.md"), "x\n");
  execSync("git add residue.md", { cwd: workpieceDir, stdio: "pipe" });

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");
  const input = {
    flags: {
      mission: "test-system-m000001",
      message: "chore: re-bootstrap snapshot",
      "scope-files": "README.md",
    },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);
  expect(result.exitCode ?? 0).toBe(0);
  expect(
    result.data?.noChanges,
    "Scoped commit must detect worktree-vs-HEAD inside the scope — staged residue alone is not a change",
  ).toBe(true);

  const logOutput = execSync("git log --oneline", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  expect(logOutput.split("\n")).toHaveLength(1);
});

test("ADR-0096: --scope-files fails loudly when a listed path does not exist", async () => {
  setupWorkpiece();

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");
  const input = {
    flags: {
      mission: "test-system-m000001",
      message: "scoped",
      "scope-files": "does/not/exist.yaml",
    },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

  await expect(runMissionGitCommit(input, context)).rejects.toThrow(/git add/);
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
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

  await runMissionGitCommit(input, context);

  // Files should still be staged (git status --porcelain shows them)
  const statusOutput = execSync("git status --porcelain", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  expect(statusOutput).toContain("src/content/business-profile/de/offerings.md");
});

// ---------------------------------------------------------------------------
// RFC-1095: compass.summary.record integration
// ---------------------------------------------------------------------------

const WORKPIECE_TS_WITH_HEADER = `/*
<MODULE_CONTRACT>
<purpose>Workpiece feature module for record integration coverage.</purpose>

</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0001: initial.</item>
</CHANGE_SUMMARY>
*/
export const f = 1;
`;

test("RFC-1095: --rfc records CHANGE_SUMMARY item and writes X-RFC trailer (AC-10)", async () => {
  const workpieceDir = setupWorkpiece();

  mkdirSync(join(workpieceDir, "src"), { recursive: true });
  writeFileSync(join(workpieceDir, "src", "feature.ts"), WORKPIECE_TS_WITH_HEADER);

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");

  const input = {
    flags: {
      mission: "test-system-m000001",
      message: "implement: RFC-1095 record",
      rfc: "RFC-1095",
    },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);
  expect(result.exitCode ?? 0).toBe(0);

  const source = readFileSync(join(workpieceDir, "src", "feature.ts"), "utf-8");
  expect(source).toContain("<item>RFC-1095: record</item>");

  const logBody = execSync("git log -1 --format=%B", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  expect(logBody).toContain("X-RFC: RFC-1095");
});

test("RFC-1095: --adr writes X-ADR trailer", async () => {
  const workpieceDir = setupWorkpiece();

  writeFileSync(join(workpieceDir, "astro.config.mjs"), "// config\n");

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");

  const input = {
    flags: { mission: "test-system-m000001", message: "chore: config tweak", adr: "ADR-0042" },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);
  expect(result.exitCode ?? 0).toBe(0);

  const logBody = execSync("git log -1 --format=%B", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  expect(logBody).toContain("X-ADR: ADR-0042");
});

// ---------------------------------------------------------------------------
// RFC-1199: materialization-in-progress preflight (AC-1, AC-3)
// ---------------------------------------------------------------------------

test("RFC-1199 AC-1: sentinel in workpiece/.git blocks commit with MATERIALIZATION_IN_PROGRESS", async () => {
  const workpieceDir = setupWorkpiece();
  const { MATERIALIZATION_SENTINEL } = await import("../mission/mission-materialize.ts");
  writeFileSync(
    join(workpieceDir, ".git", MATERIALIZATION_SENTINEL),
    JSON.stringify({ missionId: "test-system-m000001" }) + "\n",
  );
  writeFileSync(join(workpieceDir, "dirty.txt"), "in-flight change\n");

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");
  const input = {
    flags: { mission: "test-system-m000001", message: "raced commit" },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);
  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("MATERIALIZATION_IN_PROGRESS");
  expect(result.nextSteps?.[0]?.action).toContain("mission.resume");

  // Guard precedes staging — the dirty file must not be staged or committed.
  const statusOutput = execSync("git status --porcelain", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  expect(statusOutput).toContain("?? dirty.txt");
  const logOutput = execSync("git log --oneline", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  expect(logOutput.split("\n")).toHaveLength(1);
});

test("RFC-1199 AC-3: materializedAt null without sentinel blocks with the same error", async () => {
  const workpieceDir = setupWorkpiece({ materializedAt: null });
  writeFileSync(join(workpieceDir, "dirty.txt"), "in-flight change\n");

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");
  const input = {
    flags: { mission: "test-system-m000001", message: "raced commit" },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);
  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("MATERIALIZATION_IN_PROGRESS");
  expect(result.summary).toContain("test-system-m000001");
});

test("RFC-1199: guard precedes the .git check — missing .git + materializedAt null still yields MATERIALIZATION_IN_PROGRESS", async () => {
  const workpieceDir = setupWorkpiece({ materializedAt: null });
  rmSync(join(workpieceDir, ".git"), { recursive: true, force: true });

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");
  const input = {
    flags: { mission: "test-system-m000001", message: "raced commit" },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
  } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);
  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("MATERIALIZATION_IN_PROGRESS");
});
