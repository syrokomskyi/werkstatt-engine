import { test, expect, describe } from "vitest";
import { detectSnap01 } from "../snapshot-auto-regen.ts";

describe("detectSnap01", () => {
  test("returns false for undefined data", () => {
    expect(detectSnap01(undefined)).toBe(false);
  });

  test("returns false for null data", () => {
    expect(detectSnap01(null)).toBe(false);
  });

  test("returns false when diagnostics is missing", () => {
    expect(detectSnap01({})).toBe(false);
  });

  test("returns false when diagnostics is not an array", () => {
    expect(detectSnap01({ diagnostics: "not-array" })).toBe(false);
  });

  test("returns false when diagnostics is empty", () => {
    expect(detectSnap01({ diagnostics: [] })).toBe(false);
  });

  test("returns false when no SNAP-01 rule", () => {
    expect(detectSnap01({ diagnostics: [{ ruleId: "OTHER-01" }] })).toBe(false);
  });

  test("returns true when SNAP-01 is present", () => {
    expect(detectSnap01({ diagnostics: [{ ruleId: "SNAP-01" }] })).toBe(true);
  });

  test("returns true when SNAP-01 is among multiple diagnostics", () => {
    expect(
      detectSnap01({ diagnostics: [{ ruleId: "OTHER-01" }, { ruleId: "SNAP-01" }] }),
    ).toBe(true);
  });
});
