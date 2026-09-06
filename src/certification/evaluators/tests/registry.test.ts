import { test, expect, describe } from "vitest";
import * as mod from "../registry.ts";

describe("evaluators/registry", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
