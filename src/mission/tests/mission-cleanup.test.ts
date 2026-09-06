import { test, expect, describe } from "vitest";
import * as mod from "../mission-cleanup.ts";

describe("mission-cleanup", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runMissionCleanup", () => {
    expect(typeof mod.runMissionCleanup).toBe("function");
  });
});
