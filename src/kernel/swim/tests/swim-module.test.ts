import { test, expect, describe } from "vitest";
import * as mod from "../swim-module.ts";

describe("swim/swim-module", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports createSwimModule", () => {
    expect(typeof mod.createSwimModule).toBe("function");
  });
});
