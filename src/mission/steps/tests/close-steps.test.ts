import { test, expect, describe } from "vitest";
import * as mod from "../close-steps.ts";

describe("close-steps", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports resolveCloseSteps", () => {
    expect(typeof mod.resolveCloseSteps).toBe("function");
  });

  test("exports buildCloseSteps", () => {
    expect(typeof mod.buildCloseSteps).toBe("function");
  });
});
