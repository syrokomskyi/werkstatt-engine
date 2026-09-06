import { test, expect, describe } from "vitest";
import * as mod from "../verify.ts";

describe("gitmesh/verify", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runGitMeshVerify", () => {
    expect(typeof mod.runGitMeshVerify).toBe("function");
  });
});
