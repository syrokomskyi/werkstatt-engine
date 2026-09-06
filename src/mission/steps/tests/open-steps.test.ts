import { test, expect, describe } from "vitest";
import * as mod from "../open-steps.ts";

describe("open-steps", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports resolveOpenSteps", () => {
    expect(typeof mod.resolveOpenSteps).toBe("function");
  });

  test("exports buildOpenSteps", () => {
    expect(typeof mod.buildOpenSteps).toBe("function");
  });
});
