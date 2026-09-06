/*
<MODULE_CONTRACT>
<purpose>RFC-0574: Integration tests for star-topology sync with real git operations.</purpose>
<keywords>RFC-0574, sync, star topology, git, integration test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0574: initial integration tests for sternsystem.sync star-topology.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { runSternsystemSync } from "./sternsystem-sync.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

let testRoot: string;
let workspaceRoot: string;
let cacheDir: string;
let bareDir: string;
let externalDir: string;

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    flags: flags as Record<string, import("@warpgogol/werkstatt-engine/kernel").KernelFlagValue>,
    argv: [],
  };
}

function makeContext(root: string): KernelRuntimeContext {
  return {
    workspaceRoot: root,
    logger: {
      section: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
    dryRun: false,
  } as unknown as KernelRuntimeContext;
}

interface MirrorSpec {
  path: string;
  storageType: "non-bare" | "bare" | "bundle";
}

async function setupSystemConfig(mirrors: MirrorSpec[]): Promise<void> {
  const config = {
    schemaVersion: "system-config/v1",
    id: "test-bundle",
    cosmicStar: "Vega",
    mirrors,
    pinnedPlatform: "4.5.0",
    status: "registered",
    registeredAt: "2026-01-01T00:00:00Z",
    notes: "",
  };
  await writeFile(join(cacheDir, "system-config.yaml"), stringifyYaml(config) + "\n", "utf8");
}

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "sync-integration-"));
  workspaceRoot = join(testRoot, "workspace");
  cacheDir = join(testRoot, "systems-cache", "test-bundle");
  bareDir = join(testRoot, "bare.git");
  externalDir = join(testRoot, "external.git");

  await mkdir(workspaceRoot, { recursive: true });

  // Create bare repos
  git(testRoot, `init --bare -b main "${bareDir}"`);
  git(testRoot, `init --bare -b main "${externalDir}"`);

  // Create cache clone with initial content
  git(testRoot, `clone "${bareDir}" "${cacheDir}"`);
  git(cacheDir, 'config user.email "test@example.com"');
  git(cacheDir, 'config user.name "Test"');
  await mkdir(join(cacheDir, "src/content"), { recursive: true });
  await writeFile(join(cacheDir, "src/content/system.md"), "# System\n");
  await mkdir(join(cacheDir, "bordbuch"), { recursive: true });
  await writeFile(join(cacheDir, "bordbuch/events.ndjson"), "");
  git(cacheDir, "add -A");
  git(cacheDir, 'commit -m "initial"');
  git(cacheDir, "push origin main");

  // Minimal workspace setup for validate
  await mkdir(join(workspaceRoot, "docs", "rfcs"), { recursive: true });
  await writeFile(join(workspaceRoot, "docs", "rfcs", "RFC-0001-test.md"), "", "utf8");
  await writeFile(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ version: "4.5.0" }),
    "utf8",
  );
  await writeFile(
    join(workspaceRoot, "uni.registry.yaml"),
    JSON.stringify({ entries: [{ id: "test", semanticId: "test", version: "1.0.0", intent: [] }] }),
    "utf8",
  );
  await mkdir(join(workspaceRoot, "packages", "dummy"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "packages", "dummy", "index.ts"),
    "export const x = 1;\n",
    "utf8",
  );
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

test("sync pushes from cache clone to bare mirror", { retry: 2 }, async () => {
  await setupSystemConfig([
    { path: cacheDir, storageType: "non-bare" },
    { path: bareDir, storageType: "bare" },
  ]);

  // Make a new commit in cache
  await writeFile(join(cacheDir, "src/content/system.md"), "# Updated\n");
  git(cacheDir, "add -A");
  git(cacheDir, 'commit -m "update"');

  const result = await runSternsystemSync(
    makeInput({ id: "test-bundle", direction: "push" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(0);

  // Verify bare repo received the commit
  const bareLog = git(bareDir, "log --oneline");
  expect(bareLog).toContain("update");
});

test("sync pushes to multiple external mirrors", { retry: 2 }, async () => {
  await setupSystemConfig([
    { path: cacheDir, storageType: "non-bare" },
    { path: bareDir, storageType: "bare" },
    { path: externalDir, storageType: "bare" },
  ]);

  // Make a new commit in cache
  await writeFile(join(cacheDir, "src/content/system.md"), "# Multi-sync\n");
  git(cacheDir, "add -A");
  git(cacheDir, 'commit -m "multi-sync"');

  const result = await runSternsystemSync(
    makeInput({ id: "test-bundle", direction: "push" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(0);

  // Both bare and external should have the commit
  const bareLog = git(bareDir, "log --oneline");
  const externalLog = git(externalDir, "log --oneline");
  expect(bareLog).toContain("multi-sync");
  expect(externalLog).toContain("multi-sync");
});

test("sync handles per-mirror failure non-fatally", { retry: 2 }, async () => {
  const nonExistentMirror = join(testRoot, "nonexistent.git");
  await setupSystemConfig([
    { path: cacheDir, storageType: "non-bare" },
    { path: bareDir, storageType: "bare" },
    { path: nonExistentMirror, storageType: "bare" },
  ]);

  // Make a new commit in cache
  await writeFile(join(cacheDir, "src/content/system.md"), "# Failure test\n");
  git(cacheDir, "add -A");
  git(cacheDir, 'commit -m "failure-test"');

  const result = await runSternsystemSync(
    makeInput({ id: "test-bundle", direction: "push" }),
    makeContext(workspaceRoot),
  );

  // Should succeed overall (non-fatal mirror failure)
  expect(result.exitCode).toBe(0);

  // Bare repo should still receive the commit
  const bareLog = git(bareDir, "log --oneline");
  expect(bareLog).toContain("failure-test");
});

test(
  "sync with external mirrors creates refs/mirror/${branch} matching bare repo HEAD",
  { retry: 2 },
  async () => {
    await setupSystemConfig([
      { path: cacheDir, storageType: "non-bare" },
      { path: bareDir, storageType: "bare" },
      { path: externalDir, storageType: "bare" },
    ]);

    // Make a new commit in cache
    await writeFile(join(cacheDir, "src/content/system.md"), "# Mirror ref test\n");
    git(cacheDir, "add -A");
    git(cacheDir, 'commit -m "mirror-ref-test"');

    const result = await runSternsystemSync(
      makeInput({ id: "test-bundle", direction: "push" }),
      makeContext(workspaceRoot),
    );

    expect(result.exitCode).toBe(0);

    // refs/mirror/main must exist and match bare repo HEAD
    const bareHead = git(bareDir, "rev-parse main");
    const mirrorRef = git(bareDir, "rev-parse refs/mirror/main");
    expect(mirrorRef).toBe(bareHead);
  },
);

test("sync without external mirrors does not create refs/mirror/${branch}", async () => {
  await setupSystemConfig([
    { path: cacheDir, storageType: "non-bare" },
    { path: bareDir, storageType: "bare" },
  ]);

  // Make a new commit in cache
  await writeFile(join(cacheDir, "src/content/system.md"), "# No mirror ref\n");
  git(cacheDir, "add -A");
  git(cacheDir, 'commit -m "no-mirror-ref"');

  const result = await runSternsystemSync(
    makeInput({ id: "test-bundle", direction: "push" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(0);

  // refs/mirror/main should NOT exist (no external mirrors)
  expect(() => git(bareDir, "rev-parse refs/mirror/main")).toThrow();
});

test("sync with single mirror (cache only) throws — no bare mirror", async () => {
  await setupSystemConfig([{ path: cacheDir, storageType: "non-bare" }]);

  await expect(
    runSternsystemSync(
      makeInput({ id: "test-bundle", direction: "push" }),
      makeContext(workspaceRoot),
    ),
  ).rejects.toThrow(/no bare mirror configured/);
});

// RFC-0818: external mirror HEAD must match refs/mirror after sync
test(
  "sync pushes bordbuch commit to external mirror — external HEAD matches refs/mirror",
  { retry: 2 },
  async () => {
    await setupSystemConfig([
      { path: cacheDir, storageType: "non-bare" },
      { path: bareDir, storageType: "bare" },
      { path: externalDir, storageType: "bare" },
    ]);

    await writeFile(join(cacheDir, "src/content/system.md"), "# Bordbuch push test\n");
    git(cacheDir, "add -A");
    git(cacheDir, 'commit -m "bordbuch-push-test"');

    const result = await runSternsystemSync(
      makeInput({ id: "test-bundle", direction: "push" }),
      makeContext(workspaceRoot),
    );

    expect(result.exitCode).toBe(0);

    const bareHead = git(bareDir, "rev-parse main");
    const mirrorRef = git(bareDir, "rev-parse refs/mirror/main");
    const externalHead = git(externalDir, "rev-parse main");

    expect(mirrorRef).toBe(bareHead);
    expect(externalHead).toBe(bareHead);

    const externalLog = git(externalDir, "log --oneline");
    expect(externalLog).toContain("Bordbuch: mirror-sync test-bundle");
  },
);

// RFC-0818: bundle mirror must include bordbuch commit
test("sync creates bundle including bordbuch commit", { retry: 2 }, async () => {
  const bundleDestDir = join(testRoot, "bundle-dest");
  await mkdir(bundleDestDir, { recursive: true });

  await setupSystemConfig([
    { path: cacheDir, storageType: "non-bare" },
    { path: bareDir, storageType: "bare" },
    { path: join(bundleDestDir, "test.bundle"), storageType: "bundle" },
  ]);

  await writeFile(join(cacheDir, "src/content/system.md"), "# Bundle bordbuch test\n");
  git(cacheDir, "add -A");
  git(cacheDir, 'commit -m "bundle-bordbuch-test"');

  const result = await runSternsystemSync(
    makeInput({ id: "test-bundle", direction: "push" }),
    makeContext(workspaceRoot),
  );

  expect(result.exitCode).toBe(0);

  const bundlePath = join(bundleDestDir, "test.bundle");
  expect(existsSync(bundlePath)).toBe(true);

  const cloneDir = join(testRoot, "bundle-clone");
  git(testRoot, `clone "${bundlePath}" "${cloneDir}"`);
  const cloneLog = git(cloneDir, "log --oneline");
  expect(cloneLog).toContain("Bordbuch: mirror-sync test-bundle");
});

// RFC-0818: regression test — residual false positive on external push failure
test(
  "sync with failing external mirror — refs/mirror tracks bare HEAD despite push failure",
  { retry: 2 },
  async () => {
    const nonExistentMirror = join(testRoot, "nonexistent.git");

    await setupSystemConfig([
      { path: cacheDir, storageType: "non-bare" },
      { path: bareDir, storageType: "bare" },
      { path: externalDir, storageType: "bare" },
      { path: nonExistentMirror, storageType: "bare" },
    ]);

    await writeFile(join(cacheDir, "src/content/system.md"), "# Push failure test\n");
    git(cacheDir, "add -A");
    git(cacheDir, 'commit -m "push-failure-test"');

    const result = await runSternsystemSync(
      makeInput({ id: "test-bundle", direction: "push" }),
      makeContext(workspaceRoot),
    );

    expect(result.exitCode).toBe(0);

    const bareHead = git(bareDir, "rev-parse main");
    const mirrorRef = git(bareDir, "rev-parse refs/mirror/main");
    const workingExternalHead = git(externalDir, "rev-parse main");

    // refs/mirror matches bare HEAD (includes bordbuch commit)
    expect(mirrorRef).toBe(bareHead);
    // The working external mirror also received the bordbuch commit
    expect(workingExternalHead).toBe(bareHead);
    // Known residual: the failed external mirror (nonExistentMirror) has N,
    // but refs/mirror = N+1 — false positive only on push failure, not on every sync.
  },
);

// ADR-0073: --force-with-lease on external mirror push overwrites diverged mirrors
test("sync overwrites diverged external mirror via --force-with-lease", { retry: 2 }, async () => {
  await setupSystemConfig([
    { path: cacheDir, storageType: "non-bare" },
    { path: bareDir, storageType: "bare" },
    { path: externalDir, storageType: "bare" },
  ]);

  // Initial sync to establish baseline
  await writeFile(join(cacheDir, "src/content/system.md"), "# Initial\n");
  git(cacheDir, "add -A");
  git(cacheDir, 'commit -m "initial-sync"');
  await runSternsystemSync(
    makeInput({ id: "test-bundle", direction: "push" }),
    makeContext(workspaceRoot),
  );

  // Diverge the external mirror — add a commit directly to it
  const externalClone = join(testRoot, "external-clone");
  git(testRoot, `clone "${externalDir}" "${externalClone}"`);
  git(externalClone, 'config user.email "test@example.com"');
  git(externalClone, 'config user.name "Test"');
  await writeFile(join(externalClone, "DIVERGE.md"), "diverged\n");
  git(externalClone, "add -A");
  git(externalClone, 'commit -m "diverge-external"');
  git(externalClone, "push origin main");

  // Now make a new commit in cache and sync — --force-with-lease should overwrite
  await writeFile(join(cacheDir, "src/content/system.md"), "# After divergence\n");
  git(cacheDir, "add -A");
  git(cacheDir, 'commit -m "after-divergence"');

  const result = await runSternsystemSync(
    makeInput({ id: "test-bundle", direction: "push" }),
    makeContext(workspaceRoot),
  );

  // Sync succeeds (no non-fast-forward error)
  expect(result.exitCode).toBe(0);

  // External mirror HEAD now matches bare repo HEAD (diverged commit overwritten)
  const bareHead = git(bareDir, "rev-parse main");
  const externalHead = git(externalDir, "rev-parse main");
  expect(externalHead).toBe(bareHead);

  // The diverged commit is gone from external mirror
  const externalLog = git(externalDir, "log --oneline");
  expect(externalLog).not.toContain("diverge-external");
});
