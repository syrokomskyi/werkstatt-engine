import { test, expect, describe } from "vitest";
import * as mod from "../mission-git-commit.ts";

describe("mission-git-commit", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runPreCommitValidation", () => {
    expect(typeof mod.runPreCommitValidation).toBe("function");
  });

  test("exports commitWorkpieceIfDirty", () => {
    expect(typeof mod.commitWorkpieceIfDirty).toBe("function");
  });

  test("exports VALIDATOR_MAPPINGS", () => {
    expect(Array.isArray(mod.VALIDATOR_MAPPINGS)).toBe(true);
  });

  test("VALIDATOR_MAPPINGS includes pbp.content.validate", () => {
    const mapping = mod.VALIDATOR_MAPPINGS.find((m) => m.validator === "pbp.content.validate");
    expect(mapping).toBeDefined();
    expect(mapping!.prefix).toBe("src/content/business-profile/");
  });

  test("VALIDATOR_MAPPINGS includes typography.validate with scoped: true (RFC-1068)", () => {
    const mapping = mod.VALIDATOR_MAPPINGS.find((m) => m.validator === "typography.validate");
    expect(mapping).toBeDefined();
    expect(mapping!.prefix).toBe("src/content/");
    expect(mapping!.scoped).toBe(true);
  });

  test("selectValidators picks typography.validate for src/content/ files", () => {
    const validators = mod.selectValidators([
      "src/content/pages/de/index.md",
      "src/content/business-profile/uk/offerings/x.md",
    ]);
    expect(validators).toContain("typography.validate");
  });

  test("selectValidators does not pick typography.validate for non-content files", () => {
    const validators = mod.selectValidators(["packages/werkstatt-site/src/checks/typography.ts"]);
    expect(validators).not.toContain("typography.validate");
  });

  test("selectValidators picks both pbp.content.validate and typography.validate for business-profile files", () => {
    const validators = mod.selectValidators([
      "src/content/business-profile/de/products/booking.md",
    ]);
    expect(validators).toContain("pbp.content.validate");
    expect(validators).toContain("typography.validate");
  });
});
