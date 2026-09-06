import { test, expect, describe } from "vitest";
import * as mod from "../mission-abort.ts";

describe("mission-abort", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports buildAbortSteps", () => {
    expect(typeof mod.buildAbortSteps).toBe("function");
  });
});
