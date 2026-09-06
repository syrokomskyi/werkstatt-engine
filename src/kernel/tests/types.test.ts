import { test, expect, describe } from "vitest";
import * as mod from "../types.ts";

describe("kernel/types", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
