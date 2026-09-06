import { test, expect, describe } from "vitest";
import {
  parseSemver,
  compareSemver,
  ltSemver,
  gtSemver,
  eqSemver,
  inOpenClosedRange,
} from "../semver.ts";

describe("parseSemver", () => {
  test("parses valid x.y.z", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
  });

  test("parses zero version", () => {
    expect(parseSemver("0.0.0")).toEqual([0, 0, 0]);
  });

  test("throws for invalid version", () => {
    expect(() => parseSemver("1.2")).toThrow();
  });

  test("throws for non-numeric", () => {
    expect(() => parseSemver("a.b.c")).toThrow();
  });

  test("trims whitespace", () => {
    expect(parseSemver("  1.2.3  ")).toEqual([1, 2, 3]);
  });
});

describe("compareSemver", () => {
  test("returns 0 for equal versions", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  test("returns -1 when a < b (minor)", () => {
    expect(compareSemver("1.1.0", "1.2.0")).toBe(-1);
  });

  test("returns 1 when a > b (major)", () => {
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
  });

  test("returns -1 when a < b (patch)", () => {
    expect(compareSemver("1.0.0", "1.0.1")).toBe(-1);
  });
});

describe("ltSemver", () => {
  test("true when a < b", () => {
    expect(ltSemver("1.0.0", "1.0.1")).toBe(true);
  });

  test("false when a >= b", () => {
    expect(ltSemver("1.0.1", "1.0.0")).toBe(false);
    expect(ltSemver("1.0.0", "1.0.0")).toBe(false);
  });
});

describe("gtSemver", () => {
  test("true when a > b", () => {
    expect(gtSemver("1.0.1", "1.0.0")).toBe(true);
  });

  test("false when a <= b", () => {
    expect(gtSemver("1.0.0", "1.0.1")).toBe(false);
    expect(gtSemver("1.0.0", "1.0.0")).toBe(false);
  });
});

describe("eqSemver", () => {
  test("true when equal", () => {
    expect(eqSemver("1.2.3", "1.2.3")).toBe(true);
  });

  test("false when not equal", () => {
    expect(eqSemver("1.2.3", "1.2.4")).toBe(false);
  });
});

describe("inOpenClosedRange", () => {
  test("true when from < v <= to", () => {
    expect(inOpenClosedRange("1.0.1", "1.0.0", "1.0.2")).toBe(true);
    expect(inOpenClosedRange("1.0.2", "1.0.0", "1.0.2")).toBe(true);
  });

  test("false when v == from (open)", () => {
    expect(inOpenClosedRange("1.0.0", "1.0.0", "1.0.2")).toBe(false);
  });

  test("false when v > to", () => {
    expect(inOpenClosedRange("1.0.3", "1.0.0", "1.0.2")).toBe(false);
  });
});
