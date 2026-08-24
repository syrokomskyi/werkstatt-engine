import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  snapshotCanonicalJsonObjectV1,
  isCanonicalJsonObjectV1,
  canonicalJsonBytesV1,
  canonicalJsonHashV1,
  CanonicalJsonInvariantError,
  CANONICAL_JSON_V1,
} from "../fingerprint/canonical-json.ts";
import { isSha256Digest, stableJsonHash } from "../fingerprint/primitives.ts";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures", "canonical-json-v1");
const vectors = JSON.parse(readFileSync(join(FIXTURES_DIR, "vectors.json"), "utf8")) as {
  accepted: { id: string; input: Record<string, unknown>; expected: string }[];
  rejected: { id: string; input: Record<string, unknown>; reason: string }[];
};

describe("canonical-json-v1: RFC 8785 vectors", () => {
  for (const v of vectors.accepted) {
    it(`accepts ${v.id}: produces exact JCS bytes`, () => {
      const result = snapshotCanonicalJsonObjectV1(v.input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(isCanonicalJsonObjectV1(result.value)).toBe(true);
      const bytes = canonicalJsonBytesV1(result.value);
      const str = Buffer.from(bytes).toString("utf8");
      expect(str).toBe(v.expected);
    });
  }

  for (const v of vectors.rejected) {
    it(`rejects ${v.id}: ${v.reason}`, () => {
      const result = snapshotCanonicalJsonObjectV1(v.input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
    });
  }
});

describe("canonical-json-v1: snapshot trust boundary", () => {
  it("rejects scalar root (string)", () => {
    const result = snapshotCanonicalJsonObjectV1("hello");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects scalar root (number)", () => {
    const result = snapshotCanonicalJsonObjectV1(42);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects array root", () => {
    const result = snapshotCanonicalJsonObjectV1([1, 2, 3]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects null root", () => {
    const result = snapshotCanonicalJsonObjectV1(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects undefined root", () => {
    const result = snapshotCanonicalJsonObjectV1(undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects NaN value", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: NaN });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects Infinity value", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: Infinity });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects negative zero", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: -0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects unsafe integer", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: Number.MAX_SAFE_INTEGER + 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects undefined value", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects bigint value", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: BigInt(42) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects function value", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: () => 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects symbol value", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: Symbol("x") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects Date object", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: new Date() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects Map object", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: new Map() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects Set object", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: new Set() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects RegExp object", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: /foo/ });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects Error object", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: new Error("x") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects toJSON customization", () => {
    const obj = { v: { toJSON: () => "custom" } };
    const result = snapshotCanonicalJsonObjectV1(obj);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects symbol keys", () => {
    const obj: Record<string, unknown> = { a: 1 };
    Object.defineProperty(obj, Symbol("x"), {
      value: 2,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const result = snapshotCanonicalJsonObjectV1(obj);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects non-enumerable property", () => {
    const obj: Record<string, unknown> = { a: 1 };
    Object.defineProperty(obj, "hidden", {
      value: 2,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    const result = snapshotCanonicalJsonObjectV1(obj);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects accessor property", () => {
    const obj: Record<string, unknown> = { a: 1 };
    Object.defineProperty(obj, "getter", { get: () => 2, enumerable: true, configurable: true });
    const result = snapshotCanonicalJsonObjectV1(obj);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects sparse array (holes)", () => {
    const arr: unknown[] = new Array(3);
    arr[0] = 1;
    arr[2] = 3;
    const result = snapshotCanonicalJsonObjectV1({ arr });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects array with extra own keys", () => {
    const arr: unknown[] = [1, 2];
    (arr as unknown as Record<string, unknown>).extra = "x";
    const result = snapshotCanonicalJsonObjectV1({ arr });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-DOMAIN-01");
  });

  it("rejects cycle", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const result = snapshotCanonicalJsonObjectV1(obj);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-TRAVERSAL-01");
  });

  it("rejects repeated reference (aliasing)", () => {
    const shared = { x: 1 };
    const obj = { a: shared, b: shared };
    const result = snapshotCanonicalJsonObjectV1(obj);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-TRAVERSAL-01");
  });

  it("rejects lone high surrogate in string", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: "\uD800" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-UNICODE-01");
  });

  it("rejects lone low surrogate in string", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: "\uDC00" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-UNICODE-01");
  });

  it("rejects lone surrogate in key", () => {
    const obj: Record<string, unknown> = {};
    obj["\uD800"] = 1;
    const result = snapshotCanonicalJsonObjectV1(obj);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-UNICODE-01");
  });

  it("accepts valid surrogate pair (emoji)", () => {
    const result = snapshotCanonicalJsonObjectV1({ v: "😀" });
    expect(result.ok).toBe(true);
  });
});

describe("canonical-json-v1: brand and invariant", () => {
  it("throws CERT-CANONICAL-BRAND-01 for forged cast", () => {
    const fake = { a: 1 } as unknown as ReturnType<
      typeof snapshotCanonicalJsonObjectV1 extends () => infer T
        ? T extends { value: infer V }
          ? () => V
          : never
        : never
    >;
    expect(() => canonicalJsonBytesV1(fake as never)).toThrow(CanonicalJsonInvariantError);
    expect(() => canonicalJsonBytesV1(fake as never)).toThrow(/CERT-CANONICAL-BRAND-01/);
  });

  it("throws for structural lookalike (plain object not in registry)", () => {
    const lookalike = { a: 1 } as unknown as Parameters<typeof canonicalJsonBytesV1>[0];
    expect(() => canonicalJsonBytesV1(lookalike)).toThrow(CanonicalJsonInvariantError);
  });

  it("throws for null", () => {
    expect(() => canonicalJsonBytesV1(null as never)).toThrow(CanonicalJsonInvariantError);
  });

  it("isCanonicalJsonObjectV1 returns false for non-branded objects", () => {
    expect(isCanonicalJsonObjectV1({ a: 1 })).toBe(false);
    expect(isCanonicalJsonObjectV1(null)).toBe(false);
    expect(isCanonicalJsonObjectV1("string")).toBe(false);
    expect(isCanonicalJsonObjectV1(42)).toBe(false);
  });

  it("isCanonicalJsonObjectV1 returns true for snapshot result", () => {
    const result = snapshotCanonicalJsonObjectV1({ a: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isCanonicalJsonObjectV1(result.value)).toBe(true);
  });
});

describe("canonical-json-v1: hash and bytes", () => {
  it("canonicalJsonHashV1 returns valid Sha256Digest", () => {
    const result = snapshotCanonicalJsonObjectV1({ a: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hash = canonicalJsonHashV1(result.value);
    expect(isSha256Digest(hash)).toBe(true);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("canonicalJsonBytesV1 returns defensive copy", () => {
    const result = snapshotCanonicalJsonObjectV1({ a: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes1 = canonicalJsonBytesV1(result.value);
    const bytes2 = canonicalJsonBytesV1(result.value);
    expect(Buffer.from(bytes1).equals(Buffer.from(bytes2))).toBe(true);
  });

  it("deterministic hash for insertion-permuted objects", () => {
    const r1 = snapshotCanonicalJsonObjectV1({ a: 1, b: 2, c: 3 });
    const r2 = snapshotCanonicalJsonObjectV1({ c: 3, a: 1, b: 2 });
    const r3 = snapshotCanonicalJsonObjectV1({ b: 2, c: 3, a: 1 });
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    if (!r1.ok || !r2.ok || !r3.ok) return;
    const h1 = canonicalJsonHashV1(r1.value);
    const h2 = canonicalJsonHashV1(r2.value);
    const h3 = canonicalJsonHashV1(r3.value);
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });

  it("array order matters — different permutations produce different bytes", () => {
    const r1 = snapshotCanonicalJsonObjectV1({ arr: [1, 2, 3] });
    const r2 = snapshotCanonicalJsonObjectV1({ arr: [3, 2, 1] });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    const b1 = Buffer.from(canonicalJsonBytesV1(r1.value)).toString("utf8");
    const b2 = Buffer.from(canonicalJsonBytesV1(r2.value)).toString("utf8");
    expect(b1).not.toBe(b2);
  });
});

describe("canonical-json-v1: limits", () => {
  it("rejects object with too many keys (>10000)", () => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 10001; i++) {
      obj[`key${i}`] = 1;
    }
    const result = snapshotCanonicalJsonObjectV1(obj);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-LIMIT-01");
    expect(result.limit).toBe("object-keys");
    expect(result.actual).toBe(10001);
    expect(result.maximum).toBe(10000);
  });

  it("rejects array with too many items (>100000)", () => {
    const arr: unknown[] = new Array(100001);
    for (let i = 0; i < 100001; i++) arr[i] = 1;
    const result = snapshotCanonicalJsonObjectV1({ arr });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-LIMIT-01");
    expect(result.limit).toBe("array-items");
    expect(result.actual).toBe(100001);
    expect(result.maximum).toBe(100000);
  });

  it("rejects string value exceeding 1 MiB", () => {
    const big = "x".repeat(1024 * 1024 + 1);
    const result = snapshotCanonicalJsonObjectV1({ v: big });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-LIMIT-01");
    expect(result.limit).toBe("string-bytes");
  });

  it("rejects key exceeding 1 KiB", () => {
    const bigKey = "k".repeat(1025);
    const obj: Record<string, unknown> = {};
    obj[bigKey] = 1;
    const result = snapshotCanonicalJsonObjectV1(obj);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-LIMIT-01");
    expect(result.limit).toBe("key-bytes");
  });

  it("rejects depth exceeding 64", () => {
    let obj: Record<string, unknown> = { deepest: true };
    for (let i = 0; i < 65; i++) {
      obj = { nested: obj };
    }
    const result = snapshotCanonicalJsonObjectV1(obj);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERT-CANONICAL-LIMIT-01");
    expect(result.limit).toBe("depth");
    expect(result.actual).toBe(65);
    expect(result.maximum).toBe(64);
  });
});

describe("canonical-json-v1: failure path safety", () => {
  it("failure path uses array indices, not raw keys", () => {
    const result = snapshotCanonicalJsonObjectV1({ arr: [1, undefined, 3] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.path).toContainEqual({ kind: "array-index", index: 1 });
  });

  it("failure path uses object sorted ordinals, not raw keys", () => {
    const result = snapshotCanonicalJsonObjectV1({ z: 1, a: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Key "a" sorts first (sortedIndex 0), so the failure should be at sortedIndex 0
    expect(result.path).toContainEqual({ kind: "object-key", sortedIndex: 0 });
  });

  it("failure message does not contain raw key values", () => {
    const secretKey = "mySecretKey123";
    const obj: Record<string, unknown> = {};
    obj[secretKey] = undefined;
    const result = snapshotCanonicalJsonObjectV1(obj);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain(secretKey);
  });

  it("CANONICAL_JSON_V1 is the correct literal", () => {
    expect(CANONICAL_JSON_V1).toBe("werkstatt/canonical-json@1");
  });
});

describe("canonical-json-v1: stableJsonHash compatibility", () => {
  it("existing stableJsonHash still works and returns string-compatible digest", () => {
    const hash = stableJsonHash({ a: 1 });
    expect(typeof hash).toBe("string");
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
