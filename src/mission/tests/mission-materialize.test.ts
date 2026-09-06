import { test, expect, describe } from "vitest";
import * as mod from "../mission-materialize.ts";

describe("mission-materialize", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports buildMaterializeSteps", () => {
    expect(typeof mod.buildMaterializeSteps).toBe("function");
  });
});
