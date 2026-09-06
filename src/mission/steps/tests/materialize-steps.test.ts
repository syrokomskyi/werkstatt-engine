import { test, expect, describe } from "vitest";
import * as mod from "../materialize-steps.ts";

describe("materialize-steps", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports buildMaterializeSteps", () => {
    expect(typeof mod.buildMaterializeSteps).toBe("function");
  });
});
