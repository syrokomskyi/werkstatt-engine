import { test, expect, describe } from "vitest";
import * as mod from "../validate.ts";

describe("profile/validate", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
