import { test, expect, describe } from "vitest";
import * as mod from "../inspection.ts";

describe("commands/inspection", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
