import { test, expect, describe } from "vitest";
import * as mod from "../platform-scope.ts";

describe("kernel/platform-scope", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
