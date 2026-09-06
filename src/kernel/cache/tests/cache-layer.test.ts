import { test, expect, describe } from "vitest";
import {
  cacheDbPath,
  CACHE_DB_RELATIVE_PATH,
  createCacheLayer,
  type CacheLayer,
} from "../cache-layer.ts";
import { NoopCacheLayer } from "../noop-cache-layer.ts";
import { join } from "node:path";

describe("cacheDbPath", () => {
  test("joins workspace root with relative path", () => {
    expect(cacheDbPath("/tmp/ws")).toBe(join("/tmp/ws", ".cache", "kernel-cache.db"));
  });

  test("CACHE_DB_RELATIVE_PATH is .cache/kernel-cache.db", () => {
    expect(CACHE_DB_RELATIVE_PATH).toBe(join(".cache", "kernel-cache.db"));
  });
});

describe("createCacheLayer", () => {
  test("returns a CacheLayer instance", async () => {
    const layer = await createCacheLayer("/tmp/nonexistent-workspace");
    expect(layer).toBeDefined();
    expect(typeof layer.get).toBe("function");
    expect(typeof layer.set).toBe("function");
    expect(typeof layer.status).toBe("function");
    expect(typeof layer.close).toBe("function");
    await layer.close();
  });

  test("falls back to NoopCacheLayer when better-sqlite3 is unavailable", async () => {
    const layer = await createCacheLayer("/tmp/nonexistent-workspace");
    if (!layer.available) {
      expect(layer).toBeInstanceOf(NoopCacheLayer);
      expect(layer.unavailableReason).toBeDefined();
    }
    await layer.close();
  });
});

describe("CacheLayer interface (via NoopCacheLayer)", () => {
  const layer: CacheLayer = new NoopCacheLayer("/tmp/test.db", "test reason");

  test("available is false", () => {
    expect(layer.available).toBe(false);
  });

  test("unavailableReason is set", () => {
    expect(layer.unavailableReason).toBe("test reason");
  });

  test("get returns null", async () => {
    expect(await layer.get("ns", "key")).toBeNull();
  });

  test("set is a no-op (does not throw)", async () => {
    await expect(layer.set("ns", "key", { a: 1 }, 123, "hash")).resolves.toBeUndefined();
  });

  test("clear is a no-op (does not throw)", async () => {
    await expect(layer.clear()).resolves.toBeUndefined();
    await expect(layer.clear("ns")).resolves.toBeUndefined();
  });

  test("status returns unavailable status", async () => {
    const status = await layer.status();
    expect(status.available).toBe(false);
    expect(status.unavailableReason).toBe("test reason");
    expect(status.namespaces).toEqual([]);
  });

  test("close is a no-op (does not throw)", async () => {
    await expect(layer.close()).resolves.toBeUndefined();
  });

  test("list returns empty array", async () => {
    expect(await layer.list?.()).toEqual([]);
  });
});
