import { test, expect, describe } from "vitest";
import { NoopCacheLayer } from "../noop-cache-layer.ts";

describe("NoopCacheLayer", () => {
  test("available is false", () => {
    const layer = new NoopCacheLayer("/tmp/test.db", "unavailable");
    expect(layer.available).toBe(false);
  });

  test("unavailableReason is set from constructor", () => {
    const layer = new NoopCacheLayer("/tmp/test.db", "my reason");
    expect(layer.unavailableReason).toBe("my reason");
  });

  test("get always returns null", async () => {
    const layer = new NoopCacheLayer("/tmp/test.db", "test");
    expect(await layer.get("ns", "key")).toBeNull();
    expect(await layer.get("rfc_entries", "rfc-0001")).toBeNull();
  });

  test("set does not throw", async () => {
    const layer = new NoopCacheLayer("/tmp/test.db", "test");
    await expect(
      layer.set("ns", "key", { data: 1 }, Date.now(), "hash123"),
    ).resolves.toBeUndefined();
  });

  test("clear without namespace does not throw", async () => {
    const layer = new NoopCacheLayer("/tmp/test.db", "test");
    await expect(layer.clear()).resolves.toBeUndefined();
  });

  test("clear with namespace does not throw", async () => {
    const layer = new NoopCacheLayer("/tmp/test.db", "test");
    await expect(layer.clear("rfc_entries")).resolves.toBeUndefined();
  });

  test("status returns unavailable with correct dbPath", async () => {
    const layer = new NoopCacheLayer("/tmp/my.db", "test reason");
    const status = await layer.status();
    expect(status.available).toBe(false);
    expect(status.unavailableReason).toBe("test reason");
    expect(status.dbPath).toBe("/tmp/my.db");
    expect(status.dbSizeBytes).toBe(0);
    expect(status.namespaces).toEqual([]);
  });

  test("close does not throw", async () => {
    const layer = new NoopCacheLayer("/tmp/test.db", "test");
    await expect(layer.close()).resolves.toBeUndefined();
  });

  test("list returns empty array", async () => {
    const layer = new NoopCacheLayer("/tmp/test.db", "test");
    expect(await layer.list()).toEqual([]);
  });

  test("list with filter returns empty array", async () => {
    const layer = new NoopCacheLayer("/tmp/test.db", "test");
    expect(await layer.list({ namespace: "rfc_entries" })).toEqual([]);
  });
});
