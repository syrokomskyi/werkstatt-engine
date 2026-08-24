import { describe, it, expect } from "vitest";
import { buildCacheKey } from "../changelog/core/ai-cache.ts";

const BASE = {
  treeHash: "abc123",
  files: ["src/a.ts", "src/b.ts"],
  diffSummary: "add login",
  promptHash: "prompt-hash-xyz",
  modelVersion: "gpt-4o",
};

describe("buildCacheKey", () => {
  it("returns a 64-char hex string", () => {
    const key = buildCacheKey(BASE);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same inputs → same key (deterministic)", () => {
    expect(buildCacheKey(BASE)).toBe(buildCacheKey(BASE));
  });

  it("files order does not affect the key", () => {
    const a = buildCacheKey({ ...BASE, files: ["src/a.ts", "src/b.ts"] });
    const b = buildCacheKey({ ...BASE, files: ["src/b.ts", "src/a.ts"] });
    expect(a).toBe(b);
  });

  it("different files → different keys", () => {
    const a = buildCacheKey({ ...BASE, files: ["src/a.ts"] });
    const b = buildCacheKey({ ...BASE, files: ["src/c.ts"] });
    expect(a).not.toBe(b);
  });

  it("different treeHash → different key", () => {
    const a = buildCacheKey({ ...BASE, treeHash: "aaa" });
    const b = buildCacheKey({ ...BASE, treeHash: "bbb" });
    expect(a).not.toBe(b);
  });

  it("different diffSummary → different key", () => {
    const a = buildCacheKey({ ...BASE, diffSummary: "add login" });
    const b = buildCacheKey({ ...BASE, diffSummary: "remove logout" });
    expect(a).not.toBe(b);
  });

  it("different promptHash → different key", () => {
    const a = buildCacheKey({ ...BASE, promptHash: "p1" });
    const b = buildCacheKey({ ...BASE, promptHash: "p2" });
    expect(a).not.toBe(b);
  });

  it("different modelVersion → different key", () => {
    const a = buildCacheKey({ ...BASE, modelVersion: "gpt-4o" });
    const b = buildCacheKey({ ...BASE, modelVersion: "claude-3-5-haiku-latest" });
    expect(a).not.toBe(b);
  });

  it("empty files array → stable key", () => {
    const key = buildCacheKey({ ...BASE, files: [] });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(buildCacheKey({ ...BASE, files: [] }));
  });
});
