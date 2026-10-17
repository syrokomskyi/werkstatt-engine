/*
<MODULE_CONTRACT>
<purpose>
Unit tests for registry covering buildRegistry; buildRegistryForModule; deriveModuleBasePath. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the registry suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

import { test, expect, describe } from "vitest";
import { buildRegistry, buildRegistryForModule, deriveModuleBasePath } from "../registry.ts";
import type { KernelAppConfig } from "@warpgogol/werkstatt-shared/kernel";
import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

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

  test("throws a descriptive error when a module loader returns undefined", async () => {
    const config: KernelAppConfig = {
      moduleLoaders: {
        "forge-rfc": async () => undefined as unknown as ModuleExport,
        "lazy-mod": async () => mockModule,
      },
    };
    await expect(buildRegistry(config)).rejects.toThrow(
      /Module loader `forge-rfc` did not return a module.*stale/,
    );
  });

  test("throws a descriptive error when a module loader returns a non-module value", async () => {
    const config: KernelAppConfig = {
      moduleLoaders: {
        "bad-mod": async () => "not-a-module" as unknown as ModuleExport,
      },
    };
    await expect(buildRegistry(config)).rejects.toThrow(
      /Module loader `bad-mod` did not return a module/,
    );
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

  test("throws a descriptive error when the resolved loader returns undefined", async () => {
    const config: KernelAppConfig = {
      moduleLoaders: { "mod-a": async () => undefined as unknown as ModuleExport },
    };
    await expect(buildRegistryForModule(config, "mod-a")).rejects.toThrow(
      /Module loader `mod-a` did not return a module/,
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

  test("RFC-1193: extracts base path up to and including /os", () => {
    expect(deriveModuleBasePath("packages/forge/os/rfc/rfc.module.ts")).toBe("packages/forge/os");
  });

  test("RFC-1193: first segment wins when both /src/ and /os/ occur", () => {
    expect(deriveModuleBasePath("packages/a/src/os/helper.ts")).toBe("packages/a/src");
    expect(deriveModuleBasePath("packages/a/os/src/helper.ts")).toBe("packages/a/os");
  });
});
