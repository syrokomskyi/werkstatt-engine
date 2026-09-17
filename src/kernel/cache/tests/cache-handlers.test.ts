import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runKernelCacheStatus, runKernelCacheClear } from "../cache-handlers.ts";
import { createCacheLayer } from "../cache-layer.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-shared/kernel";
import type { ActualState } from "@warpgogol/werkstatt-shared/kernel";

let tmpDir: string;

function makeContext(outputFormat: "pretty" | "json" = "json"): KernelRuntimeContext {
  return {
    workspaceRoot: tmpDir,
    siteExplicit: false,
    logger: {
      section: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
      event: () => {},
      getEvents: () => [],
    },
    dryRun: false,
    outputFormat,
    io: {} as never,
    actualState: {
      commands: new Map(),
      pipelines: new Map(),
      components: new Map(),
    } as unknown as ActualState,
  };
}

const mockInput: KernelCommandInput = {
  argv: [],
  flags: {},
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(process.cwd(), "tmp-cache-handlers-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("runKernelCacheStatus", () => {
  test("returns exit code 0", async () => {
    const result = await runKernelCacheStatus(mockInput, makeContext());
    expect(result.exitCode).toBe(0);
  });

  test("returns status data", async () => {
    const result = await runKernelCacheStatus(mockInput, makeContext());
    expect(result.data).toBeDefined();
    expect(result.data!.available).toBeDefined();
  });

  test("summary contains cache status info", async () => {
    const result = await runKernelCacheStatus(mockInput, makeContext());
    expect(result.summary).toContain("kernel.cache.status");
  });

  test("works in pretty mode", async () => {
    const result = await runKernelCacheStatus(mockInput, makeContext("pretty"));
    expect(result.exitCode).toBe(0);
  });
});

describe("runKernelCacheClear", () => {
  test("returns exit code 0", async () => {
    const result = await runKernelCacheClear(mockInput, makeContext());
    expect(result.exitCode).toBe(0);
  });

  test("returns cleared=true", async () => {
    const result = await runKernelCacheClear(mockInput, makeContext());
    expect(result.data!.cleared).toBe(true);
  });

  test("returns dbPath", async () => {
    const result = await runKernelCacheClear(mockInput, makeContext());
    expect(result.data!.dbPath).toBeDefined();
  });

  test("clears specific namespace when provided", async () => {
    const cache = await createCacheLayer(tmpDir);
    await cache.set("ns-a", "key1", "data", 100, "hash");
    await cache.close();

    const input: KernelCommandInput = {
      argv: [],
      flags: { namespace: "ns-a" },
    };
    const result = await runKernelCacheClear(input, makeContext());
    expect(result.data!.namespace).toBe("ns-a");
    expect(result.summary).toContain("ns-a");
  });

  test("clears all namespaces when no namespace provided", async () => {
    const result = await runKernelCacheClear(mockInput, makeContext());
    expect(result.data!.namespace).toBeUndefined();
    expect(result.summary).toContain("all");
  });
});
