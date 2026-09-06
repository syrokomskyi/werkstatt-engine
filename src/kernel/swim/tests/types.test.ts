import { test, expect, describe } from "vitest";
import * as mod from "../types.ts";

describe("swim/types", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
