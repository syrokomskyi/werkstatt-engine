/*
<MODULE_CONTRACT>
<purpose>RFC-1275 review fix: system-config.yaml / system-state.yaml read→write round-trips must preserve extension keys not (yet) declared in the zod schemas — regression coverage for the auto-pin rewrite that silently dropped integrations.journal.</purpose>
<non-goals>
  <item>Do not test git side effects — cache-clone fixtures carry no .git dir.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1275: round-trip regression tests for schema-driven config/state rewrites preserving undeclared keys.</item>
</CHANGE_SUMMARY>
*/

import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, test, expect, afterEach } from "vitest";
import {
  readSystemConfig,
  writeSystemConfig,
  readSystemState,
  writeSystemState,
} from "./registry-io.ts";

let tmp: string | undefined;

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

async function setupCacheClone(): Promise<{ workspaceRoot: string; cacheDir: string }> {
  const base = await mkdtemp(join(tmpdir(), "sternsystem-roundtrip-"));
  tmp = base;
  const workspaceRoot = join(base, "werkstatt");
  const cacheDir = join(base, "systems-cache", "test-bundle");
  await mkdir(cacheDir, { recursive: true });
  return { workspaceRoot, cacheDir };
}

const CONFIG_YAML = `schemaVersion: 1.0.0
id: test-bundle
cosmicStar: Vega
mirrors:
  - path: ./systems-cache/test-bundle
    storageType: non-bare
pinnedPlatform: 6.344.27
status: active
registeredAt: 2026-01-01T00:00:00Z
owner: did:web:example.com#operator-v1
notes: ""
integrations:
  journal:
    service: client-journal
    tenantId: ten_warpgogol000001
futureExtension:
  nested: preserved
`;

describe("system-config.yaml round-trip (RFC-1275 review)", () => {
  test("read→write preserves integrations.journal and undeclared extension keys", async () => {
    const { workspaceRoot, cacheDir } = await setupCacheClone();
    await writeFile(join(cacheDir, "system-config.yaml"), CONFIG_YAML);

    const config = await readSystemConfig(workspaceRoot, "test-bundle");
    await writeSystemConfig(workspaceRoot, "test-bundle", config);

    const written = parseYaml(await readFile(join(cacheDir, "system-config.yaml"), "utf8"));
    expect(written.integrations.journal).toEqual({
      service: "client-journal",
      tenantId: "ten_warpgogol000001",
    });
    expect(written.futureExtension).toEqual({ nested: "preserved" });
    expect(written.pinnedPlatform).toBe("6.344.27");
  });

  test("read exposes integrations.journal to typed consumers", async () => {
    const { workspaceRoot, cacheDir } = await setupCacheClone();
    await writeFile(join(cacheDir, "system-config.yaml"), CONFIG_YAML);

    const config = await readSystemConfig(workspaceRoot, "test-bundle");
    expect(config.integrations?.journal?.service).toBe("client-journal");
  });
});

const STATE_YAML = `schemaVersion: 1.0.0
systemId: test-bundle
currentMission: null
futureStateFlag: keep-me
`;

describe("system-state.yaml round-trip (RFC-1275 review)", () => {
  test("read→write preserves undeclared state keys", async () => {
    const { workspaceRoot, cacheDir } = await setupCacheClone();
    await writeFile(join(cacheDir, "system-state.yaml"), STATE_YAML);

    const state = await readSystemState(workspaceRoot, "test-bundle");
    await writeSystemState(workspaceRoot, "test-bundle", state);

    const written = parseYaml(await readFile(join(cacheDir, "system-state.yaml"), "utf8"));
    expect(written.futureStateFlag).toBe("keep-me");
    expect(written.currentMission).toBeNull();
  });
});
