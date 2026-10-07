/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1218: integration tests for generated-path conflict auto-resolution in
    mission.reconcile — generated allowlist paths resolve to the workpiece side,
    authored paths still abort, and every auto-resolved path is recorded in the
    merge commit body and the mission-reconcile bordbuch metadata.
  </purpose>
  <keywords>RFC-1218, mission.reconcile, merge conflicts, generated paths, autoResolvedPaths</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1218: initial tests for generated-path auto-resolution.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { expectData } from "../tests-handoff/helpers/kernel-result-helpers.ts";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function gitInit(dir: string): void {
  git(dir, "init");
  git(dir, 'config user.email "test@example.com"');
  git(dir, 'config user.name "Test"');
}

function gitCommitAll(dir: string, msg: string): void {
  git(dir, "add -A");
  git(dir, `commit -m ${JSON.stringify(msg)}`);
}

let testRoot: string;
let tmpWorkspace: string;
let cacheDir: string;
let workpieceDir: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rfc-1218-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
  gitInit(tmpWorkspace);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommitAll(tmpWorkspace, "initial");

  cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(cacheDir, "system-config.yaml"),
    `schemaVersion: system-config/v1
id: test-system
cosmicStar: Vega
mirrors:
  - path: "../systems-cache/test-system"
    storageType: non-bare
  - path: "../systems-cache/test-system.git"
    storageType: bare
pinnedPlatform: "4.5.0"
status: active
registeredAt: "2026-01-01T00:00:00Z"
notes: ""
`,
  );
  writeFileSync(
    join(cacheDir, "system-state.yaml"),
    `schemaVersion: system-state/v1
systemId: test-system
currentMission: test-system-m000001
lastRelease: null
`,
  );

  gitInit(cacheDir);
  mkdirSync(join(cacheDir, "src", "content"), { recursive: true });
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  writeFileSync(join(cacheDir, "src", "content", "system.md"), "# System\n");
  writeFileSync(join(cacheDir, "src", "surface.generated.yaml"), "base: true\n");
  writeFileSync(join(cacheDir, "src", "freshness.generated.yaml"), "fresh: 0\n");
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "");
  gitCommitAll(cacheDir, "initial system");

  const bareDir = join(testRoot, "systems-cache", "test-system.git");
  execSync(`git clone --bare ${JSON.stringify(cacheDir)} ${JSON.stringify(bareDir)}`, {
    stdio: "pipe",
  });
  git(cacheDir, `remote add origin ${JSON.stringify(bareDir)}`);

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  mkdirSync(join(missionDir, "evidence"), { recursive: true });
  const manifest = {
    schemaVersion: "1.0.0",
    missionId: "test-system-m000001",
    systemId: "test-system",
    state: "open",
    brief: "Test mission",
    openedAt: "2026-08-05T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: "2026-08-05T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: null,
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(
    join(missionDir, "evidence", "validation-report.json"),
    JSON.stringify({ contractFull: { passed: true }, timestamp: "2026-08-05T01:30:00.000Z" }) +
      "\n",
  );

  workpieceDir = join(missionDir, "workpiece");
  execSync(`git clone ${JSON.stringify(cacheDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function editAndCommit(dir: string, relPath: string, content: string, msg: string): void {
  writeFileSync(join(dir, relPath), content);
  git(dir, `add -- ${JSON.stringify(relPath)}`);
  git(dir, `commit -m ${JSON.stringify(msg)}`);
}

const GENERATED_OWNERSHIP = [
  {
    command: "surface.generate",
    modulePath: "packages/werkstatt-site/src/checks/module.ts",
    artifact: { path: "src/surface.generated.yaml", phase: "build.prepare" as const },
    markerPolicy: "embedded" as const,
  },
];

async function runReconcile(ownershipMap?: typeof GENERATED_OWNERSHIP) {
  const { runMissionReconcile } = await import("./mission-materialization-commands.ts");
  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    io: createDefaultIO().io,
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
    ...(ownershipMap ? { ownershipMap } : {}),
  } as unknown as KernelRuntimeContext;
  return runMissionReconcile(input, context);
}

function mergeCommitBody(): string {
  // HEAD after reconcile is a later commit (untrack / bordbuch-append) — target
  // the merge commit itself.
  return git(cacheDir, "log --merges -1 --format=%B");
}

function lastBordbuchEntry(): Record<string, unknown> {
  const lines = readFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
}

test("generated-only conflict auto-resolves to workpiece side and records audit trail", async () => {
  // Workpiece regenerates the artifact (theirs), cache clone regenerates it too (ours).
  editAndCommit(
    workpieceDir,
    "src/surface.generated.yaml",
    "base: true\nwork: piece\n",
    "wp regen",
  );
  editAndCommit(cacheDir, "src/surface.generated.yaml", "base: true\ncache: side\n", "cache regen");

  const result = await runReconcile(GENERATED_OWNERSHIP);
  const data = expectData(result);

  // AC-1: merge completed, workpiece content won. The merge commit carries the
  // workpiece bytes — the file itself is later untracked by RFC-0913, so assert
  // against the merge commit tree, not the working tree.
  const mergeSha = git(cacheDir, "log --merges -1 --format=%H");
  expect(mergeSha).not.toBe("");
  // git() trims stdout — expected strings carry no trailing newline.
  expect(git(cacheDir, `show ${mergeSha}:src/surface.generated.yaml`)).toBe(
    "base: true\nwork: piece",
  );
  expect(data.autoResolvedPaths).toContain("src/surface.generated.yaml");
  expect(result.summary).toContain("auto-resolved");

  // AC-3: merge commit body lists the path.
  expect(mergeCommitBody()).toContain("src/surface.generated.yaml");
  expect(mergeCommitBody()).toContain("reconcile mission test-system-m000001");

  // AC-3: bordbuch mission-reconcile entry carries metadata.autoResolvedPaths.
  const entry = lastBordbuchEntry();
  expect(entry.kind).toBe("mission-reconcile");
  const metadata = entry.metadata as Record<string, unknown>;
  expect(metadata.autoResolvedPaths).toContain("src/surface.generated.yaml");
});

test("authored conflict still aborts with the resolve-in-workpiece diagnostic", async () => {
  editAndCommit(workpieceDir, "src/content/system.md", "# Workpiece\n", "wp edit");
  editAndCommit(cacheDir, "src/content/system.md", "# Cache\n", "cache edit");

  const err = (await runReconcile(GENERATED_OWNERSHIP).catch((e: unknown) => e)) as Error;
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toMatch(/Resolve conflicts in the workpiece/);
  expect(err.message).toMatch(/src\/content\/system\.md/);

  // Merge was aborted — no MERGE_HEAD remains.
  expect(existsSync(join(cacheDir, ".git", "MERGE_HEAD"))).toBe(false);
});

test("mixed authored + generated conflicts still abort", async () => {
  editAndCommit(workpieceDir, "src/content/system.md", "# Workpiece\n", "wp edit");
  editAndCommit(
    workpieceDir,
    "src/surface.generated.yaml",
    "base: true\nwork: piece\n",
    "wp regen",
  );
  editAndCommit(cacheDir, "src/content/system.md", "# Cache\n", "cache edit");
  editAndCommit(cacheDir, "src/surface.generated.yaml", "base: true\ncache: side\n", "cache regen");

  await expect(runReconcile(GENERATED_OWNERSHIP)).rejects.toThrow(
    /Resolve conflicts in the workpiece/,
  );
  expect(existsSync(join(cacheDir, ".git", "MERGE_HEAD"))).toBe(false);
});

test("generated path deleted by workpiece (UD) resolves as removal", async () => {
  // Cache-side modification of a file the workpiece deleted → UD conflict.
  git(workpieceDir, "rm src/freshness.generated.yaml");
  git(workpieceDir, 'commit -m "wp removes freshness"');
  editAndCommit(cacheDir, "src/freshness.generated.yaml", "fresh: 1\n", "cache regen");

  const result = await runReconcile(GENERATED_OWNERSHIP);
  const data = expectData(result);

  expect(existsSync(join(cacheDir, "src/freshness.generated.yaml"))).toBe(false);
  expect(data.autoResolvedPaths).toContain("src/freshness.generated.yaml");
});

test("CACHE_CLONE_GENERATED_PATTERNS fallback resolves without ownershipMap", async () => {
  editAndCommit(workpieceDir, "src/freshness.generated.yaml", "fresh: 42\n", "wp regen");
  editAndCommit(cacheDir, "src/freshness.generated.yaml", "fresh: 1\n", "cache regen");

  // No ownershipMap — only the RFC-0913 constant covers this path.
  const result = await runReconcile();
  const data = expectData(result);

  const mergeSha = git(cacheDir, "log --merges -1 --format=%H");
  expect(git(cacheDir, `show ${mergeSha}:src/freshness.generated.yaml`)).toBe("fresh: 42");
  expect(data.autoResolvedPaths).toContain("src/freshness.generated.yaml");
});

test("cache-clone-only conflicts still resolve ours and are audited", async () => {
  editAndCommit(workpieceDir, "dns-records.yaml", "records:\n  - name: workpiece\n", "wp dns");
  editAndCommit(cacheDir, "dns-records.yaml", "records:\n  - name: cache\n", "cache dns");

  const result = await runReconcile(GENERATED_OWNERSHIP);
  const data = expectData(result);

  // Ours (cache) wins — clone-only paths keep their pre-existing direction.
  const mergeSha = git(cacheDir, "log --merges -1 --format=%H");
  expect(git(cacheDir, `show ${mergeSha}:dns-records.yaml`)).toBe("records:\n  - name: cache");
  expect(data.autoResolvedPaths).toContain("dns-records.yaml");
  expect(mergeCommitBody()).toContain("dns-records.yaml");
});
