import { test, expect, describe } from "vitest";
import * as mod from "@warpgogol/werkstatt-shared/kernel";

describe("kernel/types", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
