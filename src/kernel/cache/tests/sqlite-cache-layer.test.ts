import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SqliteCacheLayer } from "../sqlite-cache-layer.ts";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(process.cwd(), "tmp-sqlite-cache-"));
  dbPath = join(tmpDir, "test-cache.db");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("SqliteCacheLayer", () => {
  test("available is true", () => {
    const layer = new SqliteCacheLayer(dbPath);
    expect(layer.available).toBe(true);
    layer.close();
  });

  test("get returns null for missing key", async () => {
    const layer = new SqliteCacheLayer(dbPath);
    expect(await layer.get("ns", "missing")).toBeNull();
    await layer.close();
  });

  test("set and get round-trip", async () => {
    const layer = new SqliteCacheLayer(dbPath);
    await layer.set("ns", "key1", { foo: "bar" }, 12345, "hash123");
    const entry = await layer.get("ns", "key1");
    expect(entry).not.toBeNull();
    expect(entry!.data).toEqual({ foo: "bar" });
    expect(entry!.mtime).toBe(12345);
    expect(entry!.contentHash).toBe("hash123");
    await layer.close();
  });

  test("set overwrites existing entry", async () => {
    const layer = new SqliteCacheLayer(dbPath);
    await layer.set("ns", "key1", { v: 1 }, 100, "hash1");
    await layer.set("ns", "key1", { v: 2 }, 200, "hash2");
    const entry = await layer.get("ns", "key1");
    expect(entry!.data).toEqual({ v: 2 });
    expect(entry!.mtime).toBe(200);
    await layer.close();
  });

  test("clear with namespace removes only that namespace", async () => {
    const layer = new SqliteCacheLayer(dbPath);
    await layer.set("ns-a", "key1", "data-a", 100, "hash");
    await layer.set("ns-b", "key1", "data-b", 100, "hash");
    await layer.clear("ns-a");
    expect(await layer.get("ns-a", "key1")).toBeNull();
    expect(await layer.get("ns-b", "key1")).not.toBeNull();
    await layer.close();
  });

  test("clear without namespace removes all", async () => {
    const layer = new SqliteCacheLayer(dbPath);
    await layer.set("ns-a", "key1", "data-a", 100, "hash");
    await layer.set("ns-b", "key1", "data-b", 100, "hash");
    await layer.clear();
    expect(await layer.get("ns-a", "key1")).toBeNull();
    expect(await layer.get("ns-b", "key1")).toBeNull();
    await layer.close();
  });

  test("status returns available with namespaces", async () => {
    const layer = new SqliteCacheLayer(dbPath);
    await layer.set("ns-a", "key1", "data", 100, "hash");
    await layer.set("ns-a", "key2", "data", 100, "hash");
    const status = await layer.status();
    expect(status.available).toBe(true);
    expect(status.dbPath).toBe(dbPath);
    expect(status.namespaces).toHaveLength(1);
    expect(status.namespaces[0]!.name).toBe("ns-a");
    expect(status.namespaces[0]!.entries).toBe(2);
    await layer.close();
  });

  test("hit ratio is computed from stats", async () => {
    const layer = new SqliteCacheLayer(dbPath);
    await layer.set("ns", "key1", "data", 100, "hash");
    await layer.get("ns", "key1");
    await layer.get("ns", "key1");
    await layer.get("ns", "missing");
    const status = await layer.status();
    const ns = status.namespaces.find((n) => n.name === "ns");
    expect(ns).toBeDefined();
    expect(ns!.hitRatio).toBeGreaterThan(0);
    await layer.close();
  });

  test("close does not throw", async () => {
    const layer = new SqliteCacheLayer(dbPath);
    await expect(layer.close()).resolves.toBeUndefined();
  });

  test("list returns empty for no entries", async () => {
    const layer = new SqliteCacheLayer(dbPath);
    expect(await layer.list()).toEqual([]);
    await layer.close();
  });
});
