import { test, expect, describe } from "vitest";
import * as mod from "../abort-steps.ts";

describe("abort-steps", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports resolveAbortSteps", () => {
    expect(typeof mod.resolveAbortSteps).toBe("function");
  });

  test("exports buildAbortSteps", () => {
    expect(typeof mod.buildAbortSteps).toBe("function");
  });
});
