import { test, expect, describe } from "vitest";
import * as mod from "../candidate.ts";

describe("contracts/candidate", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports buildConfigV1Schema", () => {
    expect(mod.buildConfigV1Schema).toBeDefined();
  });

  test("exports releaseCandidateV1Schema", () => {
    expect(mod.releaseCandidateV1Schema).toBeDefined();
  });
});
