import { test, expect, describe } from "vitest";
import { createCacheModule } from "../cache-module.ts";

describe("createCacheModule", () => {
  test("returns a ModuleExport with name 'cache'", async () => {
    const mod = await createCacheModule();
    expect(mod.name).toBe("cache");
  });

  test("has version", async () => {
    const mod = await createCacheModule();
    expect(mod.version).toBeDefined();
  });

  test("registers kernel.cache.status command", async () => {
    const mod = await createCacheModule();
    const cmd = mod.commands.find((c) => c.name === "kernel.cache.status");
    expect(cmd).toBeDefined();
    expect(cmd!.scope).toBe("workspace");
    expect(cmd!.cacheable).toBe(false);
    expect(typeof cmd!.execute).toBe("function");
  });

  test("registers kernel.cache.clear command", async () => {
    const mod = await createCacheModule();
    const cmd = mod.commands.find((c) => c.name === "kernel.cache.clear");
    expect(cmd).toBeDefined();
    expect(cmd!.scope).toBe("workspace");
    expect(cmd!.mutatesState).toBe(true);
    expect(cmd!.cacheable).toBe(false);
    expect(typeof cmd!.execute).toBe("function");
  });

  test("kernel.cache.clear has namespace flag", async () => {
    const mod = await createCacheModule();
    const cmd = mod.commands.find((c) => c.name === "kernel.cache.clear");
    expect(cmd!.flags).toBeDefined();
    expect(cmd!.flags!["namespace"]).toBeDefined();
    expect(cmd!.flags!["namespace"].kind).toBe("string");
  });

  test("kernel.cache.clear declares writes", async () => {
    const mod = await createCacheModule();
    const cmd = mod.commands.find((c) => c.name === "kernel.cache.clear");
    expect(cmd!.writes).toBeDefined();
    expect(cmd!.writes).toContain(".cache/kernel-cache.db");
  });

  test("has empty pipelines array", async () => {
    const mod = await createCacheModule();
    expect(mod.pipelines).toEqual([]);
  });

  test("has empty declarations array", async () => {
    const mod = await createCacheModule();
    expect(mod.declarations).toEqual([]);
  });
});
