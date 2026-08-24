/*
<MODULE_CONTRACT>
  <purpose>RFC-0796: unit tests for checkWorkspaceGlobsForStalePackages pre-flight guard in mission.materialize.</purpose>
  <keywords>RFC-0796, workspace glob, stale package, materialize guard</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0796: initial tests for workspace glob stale package guard.</item>
</CHANGE_SUMMARY>
*/

import { test, describe, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-glob-guard-0796-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeWorkspaceYaml(workspaceRoot: string, packages: string[]): void {
  writeFileSync(
    join(workspaceRoot, "pnpm-workspace.yaml"),
    `packages:\n${packages.map((p) => `  - ${p}`).join("\n")}\n`,
  );
}

function writePkgJson(dir: string, name: string, deps?: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, dependencies: deps ?? {} }, null, 2),
  );
}

describe("RFC-0796: checkWorkspaceGlobsForStalePackages", () => {
  test("clean workspace — no stale packages", async () => {
    const { checkWorkspaceGlobsForStalePackages } = await import(
      "../mission/mission-materialize.ts"
    );
    writeWorkspaceYaml(tmpDir, ["packages/*"]);
    writePkgJson(join(tmpDir, "packages", "pkg-a"), "@test/pkg-a", {
      "@test/pkg-b": "workspace:*",
    });
    writePkgJson(join(tmpDir, "packages", "pkg-b"), "@test/pkg-b");

    const result = await checkWorkspaceGlobsForStalePackages(tmpDir);

    expect(result.ok).toBe(true);
    expect(result.stalePackages).toHaveLength(0);
  });

  test("stale workspace:* reference to missing package", async () => {
    const { checkWorkspaceGlobsForStalePackages } = await import(
      "../mission/mission-materialize.ts"
    );
    writeWorkspaceYaml(tmpDir, ["packages/*", "missions/*/workpiece"]);
    writePkgJson(join(tmpDir, "packages", "pkg-a"), "@test/pkg-a", {
      "@test/missing-pkg": "workspace:*",
    });

    const result = await checkWorkspaceGlobsForStalePackages(tmpDir);

    expect(result.ok).toBe(false);
    expect(result.stalePackages.length).toBe(1);
    expect(result.stalePackages[0]).toContain("@test/missing-pkg");
  });

  test("no pnpm-workspace.yaml returns ok", async () => {
    const { checkWorkspaceGlobsForStalePackages } = await import(
      "../mission/mission-materialize.ts"
    );

    const result = await checkWorkspaceGlobsForStalePackages(tmpDir);

    expect(result.ok).toBe(true);
    expect(result.stalePackages).toHaveLength(0);
  });

  test("non-workspace dependencies are not checked", async () => {
    const { checkWorkspaceGlobsForStalePackages } = await import(
      "../mission/mission-materialize.ts"
    );
    writeWorkspaceYaml(tmpDir, ["packages/*"]);
    writePkgJson(join(tmpDir, "packages", "pkg-a"), "@test/pkg-a", {
      "some-external-pkg": "^1.0.0",
    });

    const result = await checkWorkspaceGlobsForStalePackages(tmpDir);

    expect(result.ok).toBe(true);
    expect(result.stalePackages).toHaveLength(0);
  });
});
