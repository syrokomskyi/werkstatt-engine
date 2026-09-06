import { test, expect, describe } from "vitest";
import * as mod from "../mission-preflight.ts";

describe("mission-preflight", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runMissionPreflight", () => {
    expect(typeof mod.runMissionPreflight).toBe("function");
  });
});
