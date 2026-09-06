import { test, expect, describe } from "vitest";
import * as mod from "../init.ts";

describe("dht/init", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runDhtNodeInit", () => {
    expect(typeof mod.runDhtNodeInit).toBe("function");
  });
});
