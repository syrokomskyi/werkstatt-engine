/*
<MODULE_CONTRACT>
<purpose>
Unit tests for workspace discovery covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the workspace suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { discoverWorkspacePackages } from "../workspace-discovery.ts";

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "workspace-discovery-"));
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n  - services/*\n  - packages/*\n  - packages/os/*\n  - '!packages/ignored'\n",
    "utf8",
  );

  for (const directory of [
    "apps/site",
    "services/worker",
    "packages/share",
    "packages/werkstatt",
    "packages/ignored",
    "packages/-draft",
  ]) {
    await mkdir(join(root, directory), { recursive: true });
  }

  await writeJson(join(root, "apps/site/package.json"), { name: "site" });
  await writeJson(join(root, "services/worker/package.json"), {
    name: "@warpgogol/worker",
  });
  await writeJson(join(root, "packages/share/package.json"), {
    name: "@warpgogol/werkstatt-shared",
  });
  await writeJson(join(root, "packages/werkstatt/package.json"), {
    name: "@warpgogol/werkstatt-engine",
  });
  await writeJson(join(root, "packages/ignored/package.json"), { name: "@warpgogol/ignored" });
  await writeJson(join(root, "packages/-draft/package.json"), { name: "@warpgogol/draft" });
  return root;
}

test("discoverWorkspacePackages expands and classifies supported workspace globs", async () => {
  const root = await createWorkspace();
  try {
    const result = await discoverWorkspacePackages(root);
    expect(result.packageGlobs).toEqual(["apps/*", "packages/*", "packages/os/*", "services/*"]);
    expect(result.packages.map((pkg) => [pkg.directory, pkg.workspacePattern, pkg.kind])).toEqual([
      ["apps/site", "apps/*", "app"],
      ["packages/share", "packages/*", "package"],
      ["packages/werkstatt", "packages/*", "package"],
      ["services/worker", "services/*", "service"],
    ]);
    expect(result.diagnostics.length).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discoverWorkspacePackages reports unsupported patterns and missing names", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-discovery-"));
  try {
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      "packages:\n  - plugins/**\n  - misc/*\n",
      "utf8",
    );
    await mkdir(join(root, "misc", "unnamed"), { recursive: true });
    await writeJson(join(root, "misc", "unnamed", "package.json"), { version: "0.0.0" });

    const result = await discoverWorkspacePackages(root);
    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId).sort()).toEqual([
      "WORKSPACE-DISCOVERY-01",
      "WORKSPACE-DISCOVERY-02",
      "WORKSPACE-DISCOVERY-03",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
