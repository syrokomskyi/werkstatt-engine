/*
<MODULE_CONTRACT>
<purpose>
Unit tests for discovery covering kernel/discovery; loadKernelAppConfig. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the discovery suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

import { test, expect, describe } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as mod from "../discovery.ts";
import type { DiscoveredSiteWorkspace } from "@warpgogol/werkstatt-shared/kernel";

describe("kernel/discovery", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports discoverSiteWorkspaces", () => {
    expect(typeof mod.discoverSiteWorkspaces).toBe("function");
  });

  test("exports findWorkspaceRoot", () => {
    expect(typeof mod.findWorkspaceRoot).toBe("function");
  });
});

describe("loadKernelAppConfig", () => {
  test("wraps unresolvable config imports with site name and config path", async () => {
    const root = await mkdtemp(join(tmpdir(), "kernel-discovery-"));
    try {
      const configPath = join(root, "kernel.config.ts");
      await writeFile(
        configPath,
        'import "nonexistent-pkg-unresolvable";\nexport default { moduleLoaders: {} };\n',
      );
      const site: DiscoveredSiteWorkspace = {
        name: "broken-site",
        directory: root,
        toolsDirectory: root,
        configPath,
      };
      await expect(mod.loadKernelAppConfig(site)).rejects.toThrow(
        /Failed to load kernel config.*broken-site.*nonexistent-pkg-unresolvable/s,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
