import { test, expect, describe } from "vitest";
import * as mod from "../validation-state-inspect.ts";

describe("validation-state-inspect", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runValidationStateInspect", () => {
    expect(typeof mod.runValidationStateInspect).toBe("function");
  });
});
