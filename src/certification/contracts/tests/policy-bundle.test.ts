import { test, expect, describe } from "vitest";
import * as mod from "../policy-bundle.ts";

describe("contracts/policy-bundle", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
