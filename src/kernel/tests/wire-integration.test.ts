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
    RFC-1057/RFC-1147: Integration test for kernel.wire. Runs runKernelWire on a
    minimal fixture and verifies the generated kernel.config.ts delegates to
    siteModuleLoaders() — the canonical SITE_MODULE_MAP surface. Guards the
    uniform-surface contract: exactly one emitted file, no tools/modules or
    tools/runtime output.
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

describe("RFC-1147: kernel.wire uniform surface", () => {
  let tmpDir: string;
  let siteDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rfc1147-wire-"));
    siteDir = join(tmpDir, "test-app");
    await mkdir(join(siteDir, "src", "content"), { recursive: true });
    await mkdir(join(siteDir, "tools"), { recursive: true });
    await writeFile(join(siteDir, "src", "content", "system.md"), SYSTEM_MD);
    await writeFile(join(siteDir, "package.json"), PACKAGE_JSON);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("generates only tools/kernel.config.ts — no tools/modules or tools/runtime", async () => {
    const context = await makeContext(WORKSPACE_ROOT, siteDir);
    const input: KernelCommandInput = { argv: [], flags: {} };

    const result = await runKernelWire(input, context);

    expect(result.exitCode).toBe(0);
    expect(result.data?.status).toBe("ok");
    expect(result.data?.generated).toEqual(["tools/kernel.config.ts"]);

    expect(existsSync(join(siteDir, "tools", "kernel.config.ts"))).toBe(true);
    expect(existsSync(join(siteDir, "tools", "modules"))).toBe(false);
    expect(existsSync(join(siteDir, "tools", "runtime"))).toBe(false);
  });

  test("generated kernel.config.ts delegates to siteModuleLoaders()", async () => {
    const context = await makeContext(WORKSPACE_ROOT, siteDir);
    const input: KernelCommandInput = { argv: [], flags: {} };

    await runKernelWire(input, context);

    const configPath = join(siteDir, "tools", "kernel.config.ts");
    const content = await readFile(configPath, "utf-8");

    expect(content).toContain('from "@warpgogol/werkstatt-engine/kernel"');
    expect(content).toContain("defineKernelConfig");
    expect(content).toContain("siteModuleLoaders");
    expect(content).toContain("moduleLoaders: siteModuleLoaders()");
    expect(content).toContain('name: "test-app"');

    // No per-module loader literals — the surface is canonical in the engine.
    expect(content).not.toContain("./modules/");
    expect(content).not.toContain("createForgeRfcModule");
  });
});
