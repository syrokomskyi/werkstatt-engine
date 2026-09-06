import { test, expect, describe } from "vitest";
import * as mod from "../sync.ts";

describe("gitmesh/sync", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runGitMeshSync", () => {
    expect(typeof mod.runGitMeshSync).toBe("function");
  });
});
