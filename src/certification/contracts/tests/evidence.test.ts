import { test, expect, describe } from "vitest";
import * as mod from "../evidence.ts";

describe("contracts/evidence", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports evidenceEnvelopeV1Schema", () => {
    expect(mod.evidenceEnvelopeV1Schema).toBeDefined();
  });
});
