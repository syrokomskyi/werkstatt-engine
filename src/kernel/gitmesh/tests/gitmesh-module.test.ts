import { test, expect, describe } from "vitest";
import * as mod from "../gitmesh-module.ts";

describe("gitmesh/gitmesh-module", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports createGitmeshModule", () => {
    expect(typeof mod.createGitmeshModule).toBe("function");
  });
});
