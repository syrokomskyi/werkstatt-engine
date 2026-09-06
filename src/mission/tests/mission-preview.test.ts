import { test, expect, describe } from "vitest";
import * as mod from "../mission-preview.ts";

describe("mission-preview", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runMissionPreview", () => {
    expect(typeof mod.runMissionPreview).toBe("function");
  });
});
