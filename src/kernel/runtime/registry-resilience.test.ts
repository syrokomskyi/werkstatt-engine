/*
<MODULE_CONTRACT>
  <purpose>
  Regression test for listRegisteredKernelCommands / listRegisteredKernelCommandNames /
  listRegisteredKernelPipelines resilience — ensures a single broken site does not
  crash the entire function. Fixed in warpgogol-m000131 when my-warpgogol cache clone
  lacked node_modules causing ERR_MODULE_NOT_FOUND.
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>warpgogol-m000131: initial regression test for site loading resilience.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("../discovery.ts", () => ({
  discoverSiteWorkspaces: vi.fn().mockResolvedValue([]),
  loadKernelAppConfig: vi.fn(),
}));

vi.mock("./registry-cache.ts", () => ({
  getOrBuildRegistry: vi.fn(),
  getOrBuildWorkspaceRegistry: vi.fn().mockResolvedValue(undefined),
}));

import {
  listRegisteredKernelCommands,
  listRegisteredKernelCommandNames,
  listRegisteredKernelPipelines,
} from "./registry.ts";
import { discoverSiteWorkspaces, loadKernelAppConfig } from "../discovery.ts";
import { getOrBuildRegistry } from "./registry-cache.ts";

const mockDiscover = vi.mocked(discoverSiteWorkspaces);
const mockLoadKernelAppConfig = vi.mocked(loadKernelAppConfig);
const mockGetOrBuildRegistry = vi.mocked(getOrBuildRegistry);

let tmpDir: string;

function makeSiteDir(name: string): string {
  const dir = path.join(tmpDir, name);
  mkdirSync(path.join(dir, "tools"), { recursive: true });
  return dir;
}

function makeRegistry(commands: string[], pipelines: [string, { command: string }[]][] = []) {
  return {
    listCommandNames: () => commands,
    getCommand: (name: string) => ({ name, scope: "workspace" }),
    commandModules: new Map(),
    pipelines: new Map(pipelines),
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "registry-resilience-XXXX-"));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("listRegisteredKernelCommands resilience", () => {
  it("skips broken sites with a warning instead of crashing", async () => {
    const goodDir = makeSiteDir("good-site");
    const brokenDir = makeSiteDir("broken-site");

    mockDiscover.mockResolvedValue([
      {
        name: "good-site",
        directory: goodDir,
        configPath: "tools/kernel.config.ts",
        toolsDirectory: path.join(goodDir, "tools"),
      },
      {
        name: "broken-site",
        directory: brokenDir,
        configPath: "tools/kernel.config.ts",
        toolsDirectory: path.join(brokenDir, "tools"),
      },
    ] as never);

    mockLoadKernelAppConfig
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(
        new Error(
          "ERR_MODULE_NOT_FOUND: Cannot find package '@warpgogol/werkstatt-engine'",
        ) as never,
      );

    mockGetOrBuildRegistry.mockResolvedValueOnce(makeRegistry(["good.command"]) as never);

    const result = await listRegisteredKernelCommands(tmpDir);

    const commandKeys = result.map((c) => `${c.provider}:${c.siteName ?? ""}:${c.name}`);
    expect(commandKeys).toContain("site:good-site:good.command");
    expect(commandKeys.some((k) => k.includes("broken-site"))).toBe(false);
  });

  it("listRegisteredKernelCommandNames skips broken sites", async () => {
    const goodDir = makeSiteDir("good-site");
    const brokenDir = makeSiteDir("broken-site");

    mockDiscover.mockResolvedValue([
      {
        name: "good-site",
        directory: goodDir,
        configPath: "tools/kernel.config.ts",
        toolsDirectory: path.join(goodDir, "tools"),
      },
      {
        name: "broken-site",
        directory: brokenDir,
        configPath: "tools/kernel.config.ts",
        toolsDirectory: path.join(brokenDir, "tools"),
      },
    ] as never);

    mockLoadKernelAppConfig
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("ERR_MODULE_NOT_FOUND") as never);

    mockGetOrBuildRegistry.mockResolvedValueOnce(makeRegistry(["good.command"]) as never);

    const names = await listRegisteredKernelCommandNames(tmpDir);

    expect(names).toContain("good.command");
  });

  it("listRegisteredKernelPipelines skips broken sites", async () => {
    const goodDir = makeSiteDir("good-site");
    const brokenDir = makeSiteDir("broken-site");

    mockDiscover.mockResolvedValue([
      {
        name: "good-site",
        directory: goodDir,
        configPath: "tools/kernel.config.ts",
        toolsDirectory: path.join(goodDir, "tools"),
      },
      {
        name: "broken-site",
        directory: brokenDir,
        configPath: "tools/kernel.config.ts",
        toolsDirectory: path.join(brokenDir, "tools"),
      },
    ] as never);

    mockLoadKernelAppConfig
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("ERR_MODULE_NOT_FOUND") as never);

    mockGetOrBuildRegistry.mockResolvedValueOnce(
      makeRegistry([], [["good.pipeline", [{ command: "good.step" }]]]) as never,
    );

    const pipelines = await listRegisteredKernelPipelines(tmpDir);

    expect(pipelines["good.pipeline"]).toBeDefined();
    expect(pipelines["good.pipeline"]).toEqual(["good.step"]);
  });
});
