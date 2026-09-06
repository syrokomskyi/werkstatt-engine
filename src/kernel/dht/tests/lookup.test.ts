import { test, expect, describe } from "vitest";
import * as mod from "../lookup.ts";

describe("dht/lookup", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runDhtLookup", () => {
    expect(typeof mod.runDhtLookup).toBe("function");
  });
});
