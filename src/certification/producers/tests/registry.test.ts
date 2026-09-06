import { test, expect, describe } from "vitest";
import * as mod from "../registry.ts";

describe("producers/registry", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
