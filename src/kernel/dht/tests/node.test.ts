import { test, expect, describe } from "vitest";
import * as mod from "../node.ts";

describe("dht/node", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports createDhtNode", () => {
    expect(typeof mod.createDhtNode).toBe("function");
  });

  test("exports generateSybilResistantNodeId", () => {
    expect(typeof mod.generateSybilResistantNodeId).toBe("function");
  });
});
