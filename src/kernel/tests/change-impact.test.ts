import { test, expect, describe } from "vitest";
import * as mod from "../change-impact.ts";

describe("kernel/change-impact", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
