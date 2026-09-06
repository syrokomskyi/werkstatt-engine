import { test, expect, describe } from "vitest";
import * as mod from "../authority.ts";

describe("contracts/authority", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports issuerRegistryEntryV1Schema", () => {
    expect(mod.issuerRegistryEntryV1Schema).toBeDefined();
  });
});
