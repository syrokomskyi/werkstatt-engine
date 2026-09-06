import { test, expect, describe } from "vitest";
import * as mod from "../mission-close.ts";

describe("mission-close", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports buildCloseSteps", () => {
    expect(typeof mod.buildCloseSteps).toBe("function");
  });
});
