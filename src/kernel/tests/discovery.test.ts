import { test, expect, describe } from "vitest";
import * as mod from "../discovery.ts";

describe("kernel/discovery", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports discoverSiteWorkspaces", () => {
    expect(typeof mod.discoverSiteWorkspaces).toBe("function");
  });

  test("exports findWorkspaceRoot", () => {
    expect(typeof mod.findWorkspaceRoot).toBe("function");
  });
});
