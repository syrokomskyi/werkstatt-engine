import { test, expect } from "vitest";
import fc from "fast-check";
import { stableStringify } from "../json.ts";

test("PBT: stableStringify is deterministic — same value always produces same output", () => {
  fc.assert(
    fc.property(fc.anything(), (value) => {
      expect(stableStringify(value)).toBe(stableStringify(value));
    }),
  );
});

test("PBT: stableStringify is order-independent for object keys", () => {
  fc.assert(
    fc.property(fc.record({ a: fc.integer(), b: fc.integer(), c: fc.integer() }), (obj) => {
      const reordered = { c: obj.c, b: obj.b, a: obj.a };
      expect(stableStringify(obj)).toBe(stableStringify(reordered));
    }),
  );
});

test("PBT: stableStringify always ends with newline", () => {
  fc.assert(
    fc.property(fc.anything(), (value) => {
      expect(stableStringify(value).endsWith("\n")).toBe(true);
    }),
  );
});

test("PBT: stableStringify output is valid JSON for JSON-compatible values", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.string(),
        fc.integer(),
        fc.float({ noNaN: true }),
        fc.boolean(),
        fc.constant(null),
        fc.record({ a: fc.integer(), b: fc.string() }),
        fc.array(fc.integer()),
      ),
      (value) => {
        const str = stableStringify(value).trimEnd();
        expect(() => JSON.parse(str)).not.toThrow();
      },
    ),
  );
});
