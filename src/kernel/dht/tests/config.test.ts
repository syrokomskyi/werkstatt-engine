import { test, expect, describe } from "vitest";
import * as mod from "../config.ts";

describe("dht/config", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports validateDhtConfig", () => {
    expect(typeof mod.validateDhtConfig).toBe("function");
  });

  test("exports loadDhtConfig", () => {
    expect(typeof mod.loadDhtConfig).toBe("function");
  });

  test("exports createDhtConfig", () => {
    expect(typeof mod.createDhtConfig).toBe("function");
  });
});
