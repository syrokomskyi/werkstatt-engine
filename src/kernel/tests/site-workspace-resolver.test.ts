/*
<MODULE_CONTRACT>
<purpose>
Unit tests for site workspace resolver covering resolveSiteWorkspace; RFC-1025: cache clone fallback; discoverSiteWorkspaces.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the site suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, describe } from "vitest";
import { resolveSiteWorkspace, discoverSiteWorkspaces } from "../site-workspace-resolver.ts";

async function makeWorkspace(): Promise<string> {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "resolver-test-"));
  const dir = path.join(testRoot, "workspace");
  await fs.mkdir(path.join(dir, "apps"), { recursive: true });
  await fs.mkdir(path.join(dir, "missions"), { recursive: true });
  await fs.mkdir(path.join(dir, "systems"), { recursive: true });
  return dir;
}

async function writeApp(wsRoot: string, id: string): Promise<void> {
  const appDir = path.join(wsRoot, "apps", id);
  await fs.mkdir(appDir, { recursive: true });
  await fs.writeFile(
    path.join(appDir, "package.json"),
    JSON.stringify({ name: `@warpgogol/${id}` }),
  );
}

async function writeWorkpiece(wsRoot: string, missionId: string, siteId: string): Promise<void> {
  const wpDir = path.join(wsRoot, "missions", missionId, "workpiece");
  await fs.mkdir(wpDir, { recursive: true });
  await fs.writeFile(
    path.join(wpDir, "package.json"),
    JSON.stringify({ name: `@warpgogol/${siteId}` }),
  );
}

// Real cache clones carry system-config.yaml (written by writeSystemFiles)
// and tools/kernel.config.ts, but never package.json — the generated manifest
// is gitignored and exists only in materialized workpieces.
async function writeCacheCloneKernelConfig(wsRoot: string, siteId: string): Promise<void> {
  const cacheDir = path.join(wsRoot, "..", "systems-cache", siteId);
  await fs.mkdir(path.join(cacheDir, "tools"), { recursive: true });
  await fs.writeFile(path.join(cacheDir, "tools", "kernel.config.ts"), "export default {};\n");
}

async function writeSystemFiles(
  wsRoot: string,
  systems: { id: string; currentMission?: string }[],
): Promise<void> {
  const { stringify: stringifyYaml } = await import("yaml");
  for (const sys of systems) {
    const cacheDir = path.join(wsRoot, "..", "systems-cache", sys.id);
    await fs.mkdir(cacheDir, { recursive: true });
    const config = {
      schemaVersion: "system-config/v1",
      id: sys.id,
      cosmicStar: "Vega",
      mirrors: [{ path: `./systems/${sys.id}`, storageType: "non-bare" }],
      pinnedPlatform: "4.5.0",
      status: "active",
      registeredAt: "2026-01-01T00:00:00Z",
      notes: "",
    };
    await fs.writeFile(path.join(cacheDir, "system-config.yaml"), stringifyYaml(config) + "\n");
    if (sys.currentMission) {
      const state = {
        schemaVersion: "system-state/v1",
        systemId: sys.id,
        currentMission: sys.currentMission,
      };
      await fs.writeFile(path.join(cacheDir, "system-state.yaml"), stringifyYaml(state) + "\n");
    }
  }
}

describe("resolveSiteWorkspace", () => {
  test("resolves from apps/ when no registry entry", async () => {
    const ws = await makeWorkspace();
    await writeApp(ws, "demo");
    const result = await resolveSiteWorkspace(ws, "demo");
    expect(result.source).toBe("apps");
    expect(result.name).toBe("demo");
    expect(result.missionId).toBeNull();
  });

  test("resolves from mission workpiece when registry has currentMission", async () => {
    const ws = await makeWorkspace();
    await writeSystemFiles(ws, [{ id: "demo", currentMission: "demo-m000001" }]);
    await writeWorkpiece(ws, "demo-m000001", "demo");
    const result = await resolveSiteWorkspace(ws, "demo");
    expect(result.source).toBe("mission");
    expect(result.name).toBe("demo");
    expect(result.missionId).toBe("demo-m000001");
  });

  test("prefers mission workpiece when both apps/ and workpiece exist with currentMission", async () => {
    const ws = await makeWorkspace();
    await writeSystemFiles(ws, [{ id: "demo", currentMission: "demo-m000001" }]);
    await writeApp(ws, "demo");
    await writeWorkpiece(ws, "demo-m000001", "demo");
    const result = await resolveSiteWorkspace(ws, "demo");
    expect(result.source).toBe("mission");
    expect(result.name).toBe("demo");
    expect(result.missionId).toBe("demo-m000001");
  });

  test("throws for unknown site id", async () => {
    const ws = await makeWorkspace();
    await writeApp(ws, "demo");
    await expect(resolveSiteWorkspace(ws, "nope")).rejects.toThrow("Unknown site id");
  });
});

describe("RFC-1025: cache clone fallback", () => {
  test("AC-1: resolves cache clone when no mission and no apps/", async () => {
    const ws = await makeWorkspace();
    await writeSystemFiles(ws, [{ id: "demo" }]);
    await writeCacheCloneKernelConfig(ws, "demo");
    const result = await resolveSiteWorkspace(ws, "demo");
    expect(result.source).toBe("cache-clone");
    expect(result.name).toBe("demo");
    expect(result.missionId).toBeNull();
  });

  test("AC-2: prefers mission workpiece over cache clone", async () => {
    const ws = await makeWorkspace();
    await writeSystemFiles(ws, [{ id: "demo", currentMission: "demo-m000001" }]);
    await writeWorkpiece(ws, "demo-m000001", "demo");
    await writeCacheCloneKernelConfig(ws, "demo");
    const result = await resolveSiteWorkspace(ws, "demo");
    expect(result.source).toBe("mission");
    expect(result.missionId).toBe("demo-m000001");
  });

  test("AC-3: throws Unknown site id when no cache clone, no mission, no apps/", async () => {
    // A stray systems-cache/<id> directory without system-config.yaml is not
    // a cache clone — the marker file is what makes it resolvable.
    const ws = await makeWorkspace();
    await fs.mkdir(path.join(ws, "..", "systems-cache", "demo"), { recursive: true });
    await expect(resolveSiteWorkspace(ws, "demo")).rejects.toThrow("Unknown site id");
  });

  test("resolves a real cache clone — system-config.yaml only, no package.json", async () => {
    // Regression: the resolver previously required package.json, which is
    // gitignored and absent from every real clone — the fallback was dead.
    // system-config.yaml (already written by writeSystemFiles) is the marker.
    const ws = await makeWorkspace();
    await writeSystemFiles(ws, [{ id: "demo" }]);
    const result = await resolveSiteWorkspace(ws, "demo");
    expect(result.source).toBe("cache-clone");
    expect(result.configPath).toBeUndefined();
    expect(result.packageName).toBeUndefined();
  });

  test("AC-4: discoverSiteWorkspaces includes cache clone-resolvable sites", async () => {
    const ws = await makeWorkspace();
    await writeSystemFiles(ws, [{ id: "alpha" }]);
    await writeCacheCloneKernelConfig(ws, "alpha");
    const results = await discoverSiteWorkspaces(ws);
    expect(results.length).toBe(1);
    expect(results[0]!.source).toBe("cache-clone");
    expect(results[0]!.name).toBe("alpha");
  });
});

describe("discoverSiteWorkspaces", () => {
  test("discovers apps/ sites", async () => {
    const ws = await makeWorkspace();
    await writeApp(ws, "alpha");
    await writeApp(ws, "beta");
    const results = await discoverSiteWorkspaces(ws);
    expect(results.length).toBe(2);
    expect(results[0]!.name).toBe("alpha");
    expect(results[1]!.name).toBe("beta");
  });

  test("discovers mission workpieces from registry", async () => {
    const ws = await makeWorkspace();
    await writeSystemFiles(ws, [{ id: "gamma", currentMission: "gamma-m000001" }]);
    await writeWorkpiece(ws, "gamma-m000001", "gamma");
    const results = await discoverSiteWorkspaces(ws);
    expect(results.length).toBe(1);
    expect(results[0]!.source).toBe("mission");
  });

  test("prefers mission workpiece during discovery when currentMission is set", async () => {
    const ws = await makeWorkspace();
    await writeSystemFiles(ws, [{ id: "delta", currentMission: "delta-m000001" }]);
    await writeApp(ws, "delta");
    await writeWorkpiece(ws, "delta-m000001", "delta");
    const results = await discoverSiteWorkspaces(ws);
    expect(results.length).toBe(1);
    expect(results[0]!.source).toBe("mission");
    expect(results[0]!.missionId).toBe("delta-m000001");
  });

  test("cache clone outranks apps/ when workpiece exists but registry has no currentMission", async () => {
    const ws = await makeWorkspace();
    await writeSystemFiles(ws, [{ id: "delta" }]);
    await writeApp(ws, "delta");
    await writeWorkpiece(ws, "delta-m000001", "delta");
    // Without currentMission, tryResolveMissionWorkpiece returns null, so the
    // workpiece on disk is ignored. The cache clone (system-config.yaml
    // written by writeSystemFiles) outranks apps/ — read-only mirrors have no
    // dual-representation write ambiguity.
    const results = await discoverSiteWorkspaces(ws);
    expect(results.length).toBe(1);
    expect(results[0]!.source).toBe("cache-clone");
  });

  test("returns empty array when no sites exist", async () => {
    const ws = await makeWorkspace();
    const results = await discoverSiteWorkspaces(ws);
    expect(results).toEqual([]);
  });
});
