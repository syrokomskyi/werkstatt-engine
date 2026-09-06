import { test, expect, describe } from "vitest";
import * as mod from "../reconcile-steps.ts";

describe("reconcile-steps", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports resolveReconcileSteps", () => {
    expect(typeof mod.resolveReconcileSteps).toBe("function");
  });

  test("exports buildReconcileSteps", () => {
    expect(typeof mod.buildReconcileSteps).toBe("function");
  });
});
