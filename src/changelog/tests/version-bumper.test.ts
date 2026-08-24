import { describe, it, expect } from "vitest";
import { calculateNextVersion } from "../changelog/core/version-bumper.ts";
import type { ClassifiedCommit } from "../changelog/types.ts";

const THRESHOLD = 0.85;

function makeCommit(overrides: Partial<ClassifiedCommit>): ClassifiedCommit {
  return {
    hash: "abc",
    type: "chore",
    severity: "patch",
    module: "general",
    summary: "misc",
    isConventional: true,
    isBreaking: false,
    confidence: 0.95,
    ...overrides,
  };
}

const feat = makeCommit({ type: "feat", severity: "minor" });
const fix = makeCommit({ type: "fix", severity: "patch" });

describe("calculateNextVersion", () => {
  describe("version bump rules", () => {
    it("feat commit → minor bump", () => {
      const r = calculateNextVersion("1.5.3", [feat], THRESHOLD);
      expect(r.version).toBe("1.6.0");
    });

    it("fix commit → patch bump", () => {
      const r = calculateNextVersion("1.5.3", [fix], THRESHOLD);
      expect(r.version).toBe("1.5.4");
    });

    it("chore commit → patch bump", () => {
      const chore = makeCommit({ type: "chore" });
      const r = calculateNextVersion("1.5.3", [chore], THRESHOLD);
      expect(r.version).toBe("1.5.4");
    });

    it("feat + fix → minor bump (feat wins)", () => {
      const r = calculateNextVersion("1.5.3", [fix, feat], THRESHOLD);
      expect(r.version).toBe("1.6.0");
    });

    it("empty commits → patch bump", () => {
      const r = calculateNextVersion("1.5.3", [], THRESHOLD);
      expect(r.version).toBe("1.5.4");
    });
  });

  describe("breaking changes", () => {
    it("breaking + high confidence → minor bump, hasBreakingChanges=true", () => {
      const breaking = makeCommit({ type: "breaking", isBreaking: true, confidence: 0.9 });
      const r = calculateNextVersion("1.5.3", [breaking], THRESHOLD);
      expect(r.version).toBe("1.6.0");
      expect(r.hasBreakingChanges).toBe(true);
    });

    it("breaking + low confidence → requiresReview=true", () => {
      const breaking = makeCommit({ type: "breaking", isBreaking: true, confidence: 0.7 });
      const r = calculateNextVersion("1.5.3", [breaking], THRESHOLD);
      expect(r.requiresReview).toBe(true);
    });

    it("breaking + low confidence still bumps version (patch — no feat or high-conf breaking)", () => {
      const breaking = makeCommit({ type: "breaking", isBreaking: true, confidence: 0.7 });
      const r = calculateNextVersion("1.5.3", [breaking], THRESHOLD);
      expect(r.version).toBe("1.5.4");
    });

    it("no breaking commits → hasBreakingChanges=false, requiresReview=false", () => {
      const r = calculateNextVersion("1.5.3", [feat], THRESHOLD);
      expect(r.hasBreakingChanges).toBe(false);
      expect(r.requiresReview).toBe(false);
    });
  });

  describe("major version guard", () => {
    it("does not throw for normal minor bump within same major", () => {
      expect(() => calculateNextVersion("2.9.3", [feat], THRESHOLD)).not.toThrow();
      expect(calculateNextVersion("2.9.3", [feat], THRESHOLD).version).toBe("2.10.0");
    });

    it("does not throw for patch bump at x.y.9", () => {
      expect(() => calculateNextVersion("1.5.9", [fix], THRESHOLD)).not.toThrow();
      expect(calculateNextVersion("1.5.9", [fix], THRESHOLD).version).toBe("1.5.10");
    });
  });

  describe("invalid input", () => {
    it("throws for invalid semver string", () => {
      expect(() => calculateNextVersion("not-a-version", [feat], THRESHOLD)).toThrow(
        "Invalid current version",
      );
    });
  });
});
