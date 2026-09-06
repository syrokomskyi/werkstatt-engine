import { test, expect, describe } from "vitest";
import * as mod from "../handlers.ts";

describe("semantic/handlers", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runSemanticPageValidate", () => {
    expect(typeof mod.runSemanticPageValidate).toBe("function");
  });
});
