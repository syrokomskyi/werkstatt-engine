import { test, expect, describe } from "vitest";
import * as mod from "../capacity.ts";

describe("dht/capacity", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runDhtCapacityPublish", () => {
    expect(typeof mod.runDhtCapacityPublish).toBe("function");
  });

  test("exports verifyCapacity", () => {
    expect(typeof mod.verifyCapacity).toBe("function");
  });
});
