import { test, expect, describe } from "vitest";
import * as mod from "../hash.ts";

describe("profile/hash", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
