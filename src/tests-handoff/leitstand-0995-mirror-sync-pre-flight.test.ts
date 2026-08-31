/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0995: unit tests for mirror sync pre-flight check in leitstand.promote —
    verifies warning is logged when external mirrors are out of sync, when mirror
    ref is missing, and that no warning is logged when mirrors are in sync or
    when no external mirrors are configured.
  </purpose>
  <keywords>RFC-0995, leitstand, promote, mirror, sync, pre-flight, warning</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0995: initial tests for checkMirrorSyncPreFlight pure function.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { checkMirrorSyncPreFlight } from "../leitstand/leitstand-commands.ts";

let testRoot: string;
let workspaceRoot: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rfc-0995-"));
  workspaceRoot = join(testRoot, "workspace");
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function makeBareRepo(barePath: string): void {
  mkdirSync(barePath, { recursive: true });
  execSync("git init --bare -b main", { cwd: barePath, stdio: "pipe" });
}

function commitToBare(barePath: string, msg: string): string {
  const tmpClone = join(testRoot, "tmp-clone-" + Date.now());
  execSync(`git clone "${barePath}" "${tmpClone}"`, { stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: tmpClone, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: tmpClone, stdio: "pipe" });
  writeFileSync(join(tmpClone, "README.md"), `# ${msg}\n`);
  execSync("git add -A", { cwd: tmpClone, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: tmpClone, stdio: "pipe" });
  execSync("git push origin main", { cwd: tmpClone, stdio: "pipe" });
  const sha = execSync("git rev-parse HEAD", { cwd: tmpClone, encoding: "utf-8" }).trim();
  rmSync(tmpClone, { recursive: true, force: true });
  return sha;
}

function writeSystemConfig(systemId: string, mirrors: Array<{ path: string; storageType: string }>): void {
  const cacheDir = join(testRoot, "systems-cache", systemId);
  mkdirSync(cacheDir, { recursive: true });
  const mirrorsYaml = mirrors.map((m) => `  - path: "${m.path}"\n    storageType: ${m.storageType}`).join("\n");
  const configContent = `schemaVersion: system-config/v1
id: ${systemId}
cosmicStar: Vega
mirrors:
${mirrorsYaml}
pinnedPlatform: "6.0.0"
status: active
registeredAt: "2026-01-01T00:00:00Z"
notes: ""
`;
  writeFileSync(join(cacheDir, "system-config.yaml"), configContent);
}

test("warns when external mirrors are out of sync (originSha !== mirrorSha)", async () => {
  const systemId = "test-sys";
  const barePath = join(testRoot, "systems-cache", `${systemId}.git`);
  makeBareRepo(barePath);

  const sha1 = commitToBare(barePath, "first commit");
  const sha2 = commitToBare(barePath, "second commit");

  // Set refs/mirror/main to the first commit (stale)
  execSync(`git update-ref refs/mirror/main ${sha1}`, { cwd: barePath, stdio: "pipe" });

  writeSystemConfig(systemId, [
    { path: `../systems-cache/${systemId}`, storageType: "non-bare" },
    { path: `../systems-cache/${systemId}.git`, storageType: "bare" },
    { path: "https://github.com/example/repo.git", storageType: "bare" },
  ]);

  const warnings: string[] = [];
  const logger = { warn: (msg: string) => warnings.push(msg) };

  await checkMirrorSyncPreFlight(workspaceRoot, systemId, logger);

  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("external mirrors are out of sync");
  expect(warnings[0]).toContain(`origin=${sha2.slice(0, 8)}`);
  expect(warnings[0]).toContain(`mirror=${sha1.slice(0, 8)}`);
  expect(warnings[0]).toContain(`sternsystem.sync --id ${systemId}`);
});

test("warns when mirror ref not found", async () => {
  const systemId = "test-sys";
  const barePath = join(testRoot, "systems-cache", `${systemId}.git`);
  makeBareRepo(barePath);

  commitToBare(barePath, "first commit");

  // Do NOT set refs/mirror/main — simulates never-synced state

  writeSystemConfig(systemId, [
    { path: `../systems-cache/${systemId}`, storageType: "non-bare" },
    { path: `../systems-cache/${systemId}.git`, storageType: "bare" },
    { path: "https://github.com/example/repo.git", storageType: "bare" },
  ]);

  const warnings: string[] = [];
  const logger = { warn: (msg: string) => warnings.push(msg) };

  await checkMirrorSyncPreFlight(workspaceRoot, systemId, logger);

  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("mirror ref not found");
  expect(warnings[0]).toContain(`sternsystem.sync --id ${systemId}`);
});

test("no warning when mirrors are in sync (originSha === mirrorSha)", async () => {
  const systemId = "test-sys";
  const barePath = join(testRoot, "systems-cache", `${systemId}.git`);
  makeBareRepo(barePath);

  const sha = commitToBare(barePath, "only commit");

  // Set refs/mirror/main to same SHA — mirrors in sync
  execSync(`git update-ref refs/mirror/main ${sha}`, { cwd: barePath, stdio: "pipe" });

  writeSystemConfig(systemId, [
    { path: `../systems-cache/${systemId}`, storageType: "non-bare" },
    { path: `../systems-cache/${systemId}.git`, storageType: "bare" },
    { path: "https://github.com/example/repo.git", storageType: "bare" },
  ]);

  const warnings: string[] = [];
  const logger = { warn: (msg: string) => warnings.push(msg) };

  await checkMirrorSyncPreFlight(workspaceRoot, systemId, logger);

  expect(warnings).toHaveLength(0);
});

test("no warning and no error when no external mirrors configured (mirrors.length <= 2)", async () => {
  const systemId = "test-sys";
  const barePath = join(testRoot, "systems-cache", `${systemId}.git`);
  makeBareRepo(barePath);

  commitToBare(barePath, "commit");

  writeSystemConfig(systemId, [
    { path: `../systems-cache/${systemId}`, storageType: "non-bare" },
    { path: `../systems-cache/${systemId}.git`, storageType: "bare" },
  ]);

  const warnings: string[] = [];
  const logger = { warn: (msg: string) => warnings.push(msg) };

  await checkMirrorSyncPreFlight(workspaceRoot, systemId, logger);

  expect(warnings).toHaveLength(0);
});

test("silently skips when system config not found", async () => {
  const systemId = "nonexistent-sys";
  const warnings: string[] = [];
  const logger = { warn: (msg: string) => warnings.push(msg) };

  await expect(checkMirrorSyncPreFlight(workspaceRoot, systemId, logger)).resolves.toBeUndefined();
  expect(warnings).toHaveLength(0);
});

test("silently skips when bare repo does not exist", async () => {
  const systemId = "test-sys";
  // No bare repo created

  writeSystemConfig(systemId, [
    { path: `../systems-cache/${systemId}`, storageType: "non-bare" },
    { path: `../systems-cache/${systemId}.git`, storageType: "bare" },
    { path: "https://github.com/example/repo.git", storageType: "bare" },
  ]);

  const warnings: string[] = [];
  const logger = { warn: (msg: string) => warnings.push(msg) };

  await checkMirrorSyncPreFlight(workspaceRoot, systemId, logger);

  expect(warnings).toHaveLength(0);
});
