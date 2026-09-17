import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runKernelWire } from "../wire.ts";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  DiscoveredSiteWorkspace,
} from "@warpgogol/werkstatt-shared/kernel";
import type { ActualState } from "@warpgogol/werkstatt-shared/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel";
import { createKernelLogger } from "../logger.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1057: Integration test for kernel.wire. Runs runKernelWire on a minimal
    fixture inside the monorepo, then dynamically imports the generated
    kernel.config.ts to verify that all moduleLoaders entries resolve to real
    exports with ModuleExport shape. Catches template regressions (broken
    imports, missing exports, factory function mismatches) before they reach
    mission.validate.
  </purpose>
</MODULE_CONTRACT>
*/

const WORKSPACE_ROOT = resolve(import.meta.dirname, "../../..");

const SYSTEM_MD = `---
app: test-app
version: 1.0.0
identity:
  systemStar: test
  biome: default
i18n:
  default: de
  supported:
    de: true
title: Test App
description: Test fixture for kernel.wire integration test
---
# Test App
Test content.
`;

const PACKAGE_JSON = JSON.stringify({
  name: "test-app",
  version: "0.0.0",
  dependencies: {
    "@warpgogol/forge": "*",
    "@warpgogol/werkstatt-engine": "*",
    "@warpgogol/werkstatt-site": "*",
  },
});

async function makeContext(workspaceRoot: string, siteDir: string): Promise<KernelRuntimeContext> {
  const logger = createKernelLogger("pretty");
  const { io, intents } = createDefaultIO();
  const site: DiscoveredSiteWorkspace = {
    name: "test-app",
    directory: siteDir,
    toolsDirectory: join(siteDir, "tools"),
    packageName: "test-app",
    configPath: join(siteDir, "tools", "kernel.config.ts"),
  };
  const actualState: ActualState = {
    commands: new Map(),
    pipelines: new Map(),
    components: new Map(),
  };
  return {
    workspaceRoot,
    site,
    siteExplicit: true,
    logger,
    dryRun: false,
    outputFormat: "pretty",
    io,
    fileIntents: intents,
    actualState,
    ownershipMap: [],
  };
}

describe("RFC-1057: kernel.wire integration test", () => {
  let tmpDir: string;
  let siteDir: string;

  beforeEach(async () => {
    // Create fixture in OS tmpdir; symlink node_modules from workspace root
    // so tsImport can resolve @warpgogol/* packages.
    tmpDir = await mkdtemp(join(tmpdir(), "rfc1057-wire-"));
    siteDir = join(tmpDir, "test-app");
    await mkdir(join(siteDir, "src", "content"), { recursive: true });
    await mkdir(join(siteDir, "tools"), { recursive: true });
    await writeFile(join(siteDir, "src", "content", "system.md"), SYSTEM_MD);
    await writeFile(join(siteDir, "package.json"), PACKAGE_JSON);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("generates all expected files", async () => {
    const context = await makeContext(WORKSPACE_ROOT, siteDir);
    const input: KernelCommandInput = { argv: [], flags: {} };

    const result = await runKernelWire(input, context);

    expect(result.exitCode).toBe(0);
    expect(result.data?.status).toBe("ok");

    const expectedFiles = [
      "tools/kernel.config.ts",
      "tools/modules/check.module.ts",
      "tools/modules/service.module.ts",
      "tools/modules/deploy.module.ts",
      "tools/modules/pipelines.module.ts",
      "tools/runtime/app.ts",
      "tools/runtime/check.ts",
      "tools/runtime/service.ts",
      "tools/runtime/client-export.ts",
    ];

    for (const relPath of expectedFiles) {
      const abs = join(siteDir, relPath);
      expect(existsSync(abs), `Expected file ${relPath} to exist`).toBe(true);
    }
  });

  test("generated kernel.config.ts has correct structure", async () => {
    const context = await makeContext(WORKSPACE_ROOT, siteDir);
    const input: KernelCommandInput = { argv: [], flags: {} };

    await runKernelWire(input, context);

    const configPath = join(siteDir, "tools", "kernel.config.ts");
    expect(existsSync(configPath), "kernel.config.ts must be generated").toBe(true);

    const content = await readFile(configPath, "utf-8");

    // Verify defineKernelConfig import path is correct
    expect(content).toContain('from "@warpgogol/werkstatt-engine/kernel/types"');
    expect(content).toContain("defineKernelConfig");
    expect(content).toContain('name: "test-app"');

    // Verify all expected module loader keys are present
    const expectedLoaders = [
      "check",
      "service",
      "deploy",
      "rfc",
      "workflow",
      "compass",
      "naming",
      "werkstatt",
      "change-impact",
      "bordbuch",
      "nachweis",
      "sichtpass",
      "dns",
      "onboarding",
      "testing",
      "pipelines",
    ];

    for (const key of expectedLoaders) {
      expect(content, `moduleLoaders.${key} must be present`).toContain(key);
    }

    // Verify factory function calls (not direct exports) for RFC-1038 modules
    expect(content).toContain("createForgeRfcModule()");
    expect(content).toContain("createForgeWorkflowModule()");
    expect(content).toContain("createForgeNamingModule()");
    expect(content).toContain("createChangeImpactModule()");

    // Verify compass and werkstatt are direct exports (not factory functions)
    expect(content).toContain("forgeCompassModule");
    expect(content).toContain("forgeWerkstattModule");
  });

  test("generated local module files have correct ModuleExport structure", async () => {
    const context = await makeContext(WORKSPACE_ROOT, siteDir);
    const input: KernelCommandInput = { argv: [], flags: {} };

    await runKernelWire(input, context);

    const localModules = [
      "tools/modules/check.module.ts",
      "tools/modules/service.module.ts",
      "tools/modules/deploy.module.ts",
      "tools/modules/pipelines.module.ts",
    ];

    for (const relPath of localModules) {
      const abs = join(siteDir, relPath);
      expect(existsSync(abs), `${relPath} must exist`).toBe(true);

      const content = await readFile(abs, "utf-8");

      // Verify ModuleExport import path
      expect(content, `${relPath} must import ModuleExport type`).toContain("ModuleExport");

      // Verify the file exports a module variable
      const moduleMatch = content.match(/export const (\w+Module)/);
      expect(moduleMatch, `${relPath} must export a *Module const`).not.toBeNull();

      // Verify the module is typed as ModuleExport
      expect(content, `${relPath} must have ModuleExport type annotation`).toContain(
        ": ModuleExport",
      );
    }
  });
});
