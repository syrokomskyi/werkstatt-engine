import { test, expect, describe } from "vitest";
import * as mod from "../decisions.ts";

describe("contracts/decisions", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
