import { test, expect, describe } from "vitest";
import * as mod from "../mission-materialization-commands.ts";

describe("mission-materialization-commands", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports buildReconcileSteps", () => {
    expect(typeof mod.buildReconcileSteps).toBe("function");
  });

  test("exports buildValidateSteps", () => {
    expect(typeof mod.buildValidateSteps).toBe("function");
  });
});
