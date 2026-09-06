import { test, expect, describe } from "vitest";
import * as mod from "../authority.ts";

describe("deployment/authority", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
