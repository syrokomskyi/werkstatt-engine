import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  snapshotCanonicalJsonObjectV1,
  canonicalJsonBytesV1,
  canonicalJsonHashV1,
  isCanonicalJsonObjectV1,
} from "../fingerprint/canonical-json.ts";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const safeInteger = fc.integer({ min: -9007199254740991, max: 9007199254740991 });
const safeNumber = fc.oneof(
  safeInteger,
  fc.float({ min: Math.fround(-1e10), max: Math.fround(1e10), noNaN: true }),
  fc.float({ min: Math.fround(0.01), max: Math.fround(100), noNaN: true }),
);

const jsonScalar = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  safeNumber,
  fc.string({ maxLength: 100 }).filter((s) => !hasLoneSurrogate(s)),
);

const jsonString = fc
  .string({ maxLength: 100 })
  .filter((s) => !hasLoneSurrogate(s) && s !== "__proto__");

function hasLoneSurrogate(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= str.length) return true;
      const next = str.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

// Deep recursive arbitrary for JSON objects (bounded depth)
const jsonObject: fc.Arbitrary<Record<string, unknown>> = fc
  .letrec((tie) => ({
    self: fc.oneof(
      { depthSize: "small" },
      jsonScalar,
      fc.array(tie("self"), { maxLength: 5 }),
      fc.dictionary(
        jsonString.filter((s) => s.length > 0 && s !== "__proto__"),
        tie("self"),
        { maxKeys: 5 },
      ),
    ),
  }))
  .self.map((v) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : { value: v },
  );

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("canonical-json-v1 PBT: determinism", () => {
  it("same input always produces same bytes", () => {
    fc.assert(
      fc.property(jsonObject, (obj) => {
        const r1 = snapshotCanonicalJsonObjectV1(obj);
        const r2 = snapshotCanonicalJsonObjectV1(obj);
        if (r1.ok && r2.ok) {
          const b1 = Buffer.from(canonicalJsonBytesV1(r1.value)).toString("utf8");
          const b2 = Buffer.from(canonicalJsonBytesV1(r2.value)).toString("utf8");
          expect(b1).toBe(b2);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("insertion-permuted objects produce identical bytes", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          jsonString.filter((s) => s.length > 0 && s !== "__proto__"),
          jsonScalar,
          { maxKeys: 10 },
        ),
        (obj) => {
          const keys = Object.keys(obj);
          const shuffled = [...keys].reverse();
          const permuted: Record<string, unknown> = {};
          for (const k of shuffled) permuted[k] = obj[k];

          const r1 = snapshotCanonicalJsonObjectV1(obj);
          const r2 = snapshotCanonicalJsonObjectV1(permuted);
          if (r1.ok && r2.ok) {
            const b1 = Buffer.from(canonicalJsonBytesV1(r1.value)).toString("utf8");
            const b2 = Buffer.from(canonicalJsonBytesV1(r2.value)).toString("utf8");
            expect(b1).toBe(b2);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("same input always produces same hash", () => {
    fc.assert(
      fc.property(jsonObject, (obj) => {
        const r1 = snapshotCanonicalJsonObjectV1(obj);
        const r2 = snapshotCanonicalJsonObjectV1(obj);
        if (r1.ok && r2.ok) {
          expect(canonicalJsonHashV1(r1.value)).toBe(canonicalJsonHashV1(r2.value));
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("canonical-json-v1 PBT: round-trip", () => {
  it("bytes parse back to valid JSON and re-snapshot produces same bytes (idempotency)", () => {
    fc.assert(
      fc.property(jsonObject, (obj) => {
        const result = snapshotCanonicalJsonObjectV1(obj);
        if (!result.ok) return;
        const bytes = Buffer.from(canonicalJsonBytesV1(result.value)).toString("utf8");
        const parsed = JSON.parse(bytes);
        // Re-snapshotting the parsed JSON should produce identical bytes
        const result2 = snapshotCanonicalJsonObjectV1(parsed);
        if (!result2.ok) return;
        const bytes2 = Buffer.from(canonicalJsonBytesV1(result2.value)).toString("utf8");
        expect(bytes2).toBe(bytes);
      }),
      { numRuns: 200 },
    );
  });
});

describe("canonical-json-v1 PBT: collision resistance", () => {
  it("different objects produce different hashes (collision-oriented)", () => {
    fc.assert(
      fc.property(jsonObject, jsonObject, (a, b) => {
        const ra = snapshotCanonicalJsonObjectV1(a);
        const rb = snapshotCanonicalJsonObjectV1(b);
        if (!ra.ok || !rb.ok) return;
        const ha = canonicalJsonHashV1(ra.value);
        const hb = canonicalJsonHashV1(rb.value);
        const ba = Buffer.from(canonicalJsonBytesV1(ra.value)).toString("utf8");
        const bb = Buffer.from(canonicalJsonBytesV1(rb.value)).toString("utf8");
        // If bytes differ, hashes must differ
        if (ba !== bb) {
          expect(ha).not.toBe(hb);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("canonical-json-v1 PBT: mutation safety", () => {
  it("mutating input after snapshot does not change bytes", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          jsonString.filter((s) => s.length > 0 && s !== "__proto__"),
          jsonScalar,
          { maxKeys: 5 },
        ),
        (obj) => {
          const result = snapshotCanonicalJsonObjectV1(obj);
          if (!result.ok) return;
          const bytesBefore = Buffer.from(canonicalJsonBytesV1(result.value)).toString("utf8");

          // Mutate original
          obj.mutated = "extra";
          delete obj[Object.keys(obj)[0]];

          const bytesAfter = Buffer.from(canonicalJsonBytesV1(result.value)).toString("utf8");
          expect(bytesAfter).toBe(bytesBefore);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("snapshot result is frozen", () => {
    fc.assert(
      fc.property(jsonObject, (obj) => {
        const result = snapshotCanonicalJsonObjectV1(obj);
        if (!result.ok) return;
        expect(Object.isFrozen(result.value)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe("canonical-json-v1 PBT: brand safety", () => {
  it("isCanonicalJsonObjectV1 only accepts snapshot results", () => {
    fc.assert(
      fc.property(jsonObject, (obj) => {
        const result = snapshotCanonicalJsonObjectV1(obj);
        if (!result.ok) return;
        expect(isCanonicalJsonObjectV1(result.value)).toBe(true);
        // A fresh plain object with same structure is not branded
        expect(isCanonicalJsonObjectV1({ ...obj })).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
