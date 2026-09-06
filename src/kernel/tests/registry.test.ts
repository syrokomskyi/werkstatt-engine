import { test, expect, describe } from "vitest";

describe("kernel/registry", () => {
  test("registry.ts is an empty stub per RFC-1038", async () => {
    const mod = await import("../registry.ts");
    expect(mod.REGISTRY_STUB_REMOVED_BY_RFC_1038).toBe(true);
  });
});
