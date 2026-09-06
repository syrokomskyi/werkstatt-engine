import { test, expect, describe } from "vitest";
import * as mod from "../aggregation.ts";

describe("aggregation", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports evaluateCertificationDecision", () => {
    expect(typeof mod.evaluateCertificationDecision).toBe("function");
  });
});
