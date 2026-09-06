import { test, expect, describe } from "vitest";
import * as mod from "../config.ts";

describe("gitmesh/config", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports validateConfig", () => {
    expect(typeof mod.validateConfig).toBe("function");
  });

  test("exports loadGitMeshConfig", () => {
    expect(typeof mod.loadGitMeshConfig).toBe("function");
  });

  test("exports loadOrCreateConfig", () => {
    expect(typeof mod.loadOrCreateConfig).toBe("function");
  });
});
