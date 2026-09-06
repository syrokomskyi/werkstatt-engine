import { test, expect, describe } from "vitest";
import * as mod from "../mission-open.ts";

describe("mission-open", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports buildOpenSteps", () => {
    expect(typeof mod.buildOpenSteps).toBe("function");
  });
});
