import { test, expect, describe } from "vitest";
import * as mod from "../mission-list.ts";

describe("mission-list", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runMissionList", () => {
    expect(typeof mod.runMissionList).toBe("function");
  });
});
