import { test, expect, describe } from "vitest";
import * as mod from "../action-pack.ts";

describe("contracts/action-pack", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
