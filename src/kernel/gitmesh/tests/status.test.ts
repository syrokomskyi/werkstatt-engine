import { test, expect, describe } from "vitest";
import * as mod from "../status.ts";

describe("gitmesh/status", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runGitMeshStatus", () => {
    expect(typeof mod.runGitMeshStatus).toBe("function");
  });
});
