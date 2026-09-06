import { test, expect, describe } from "vitest";
import * as mod from "../status.ts";

describe("dht/status", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runDhtStatus", () => {
    expect(typeof mod.runDhtStatus).toBe("function");
  });
});
