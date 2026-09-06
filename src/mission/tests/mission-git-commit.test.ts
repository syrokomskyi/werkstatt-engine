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
});
