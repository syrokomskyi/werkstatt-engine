import { test, expect, describe } from "vitest";
import * as mod from "../validate-steps.ts";

describe("validate-steps", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports buildValidateSteps", () => {
    expect(typeof mod.buildValidateSteps).toBe("function");
  });
});
