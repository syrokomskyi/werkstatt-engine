import { test, expect, describe } from "vitest";
import {
  buildRegistry,
  buildRegistryForModule,
  deriveModuleBasePath,
} from "../registry.ts";
import type { KernelAppConfig } from "../../types.ts";
import type { ModuleExport } from "../../../runtime/desired-state.ts";

const mockModule: ModuleExport = {
  name: "test-mod",
  version: "1.0.0",
  declarations: [],
  commands: [
    {
      name: "test.ping",
      modulePath: "packages/test/src/test.ts",
      description: "Ping",
      scope: "workspace",
      flags: {},
      execute: async () => ({ exitCode: 0, ok: true, summary: "pong" }),
    },
    {
      name: "test.pong",
      modulePath: "packages/test/src/test.ts",
      description: "Pong",
      scope: "workspace",
      flags: {},
      execute: async () => ({ exitCode: 0, ok: true, summary: "ping" }),
    },
  ],
  pipelines: [
    {
      name: "test.pipeline",
      steps: [{ command: "test.ping" }, { command: "test.pong" }],
    },
  ],
};

const mockConfig: KernelAppConfig = {
  modules: [mockModule],
};

describe("buildRegistry", () => {
  test("builds actual state from config.modules", async () => {
    const state = await buildRegistry(mockConfig);
    expect(state.commands.size).toBe(2);
    expect(state.commands.has("test.ping")).toBe(true);
    expect(state.commands.has("test.pong")).toBe(true);
  });

  test("builds actual state from config.moduleLoaders", async () => {
    const config: KernelAppConfig = {
      moduleLoaders: {
        "lazy-mod": async () => mockModule,
      },
    };
    const state = await buildRegistry(config);
    expect(state.commands.size).toBe(2);
  });

  test("builds empty actual state when no modules or loaders", async () => {
    const config: KernelAppConfig = {};
    const state = await buildRegistry(config);
    expect(state.commands.size).toBe(0);
  });

  test("includes pipelines in actual state", async () => {
    const state = await buildRegistry(mockConfig);
    expect(state.pipelines.size).toBe(1);
    expect(state.pipelines.has("test.pipeline")).toBe(true);
  });
});

describe("buildRegistryForModule", () => {
  test("builds actual state for a specific module by name", async () => {
    const state = await buildRegistryForModule(mockConfig, "test-mod");
    expect(state.commands.size).toBe(2);
  });

  test("throws when module name not found in modules array", async () => {
    await expect(buildRegistryForModule(mockConfig, "nonexistent")).rejects.toThrow(
      /No module named.*nonexistent/,
    );
  });

  test("throws when module loader not found", async () => {
    const config: KernelAppConfig = {
      moduleLoaders: { "mod-a": async () => mockModule },
    };
    await expect(buildRegistryForModule(config, "nonexistent")).rejects.toThrow(
      /No module loader registered.*nonexistent/,
    );
  });

  test("returns empty state when no modules or loaders", async () => {
    const config: KernelAppConfig = {};
    const state = await buildRegistryForModule(config, "anything");
    expect(state.commands.size).toBe(0);
  });
});

describe("deriveModuleBasePath", () => {
  test("extracts base path up to and including /src", () => {
    expect(deriveModuleBasePath("packages/engine/src/kernel/runtime/registry.ts")).toBe(
      "packages/engine/src",
    );
  });

  test("returns undefined when no /src/ segment found", () => {
    expect(deriveModuleBasePath("packages/engine/kernel/registry.ts")).toBeUndefined();
  });

  test("handles paths with multiple src segments (takes first)", () => {
    expect(deriveModuleBasePath("packages/engine/src/kernel/src/helpers.ts")).toBe(
      "packages/engine/src",
    );
  });

  test("returns undefined for empty string", () => {
    expect(deriveModuleBasePath("")).toBeUndefined();
  });
});
