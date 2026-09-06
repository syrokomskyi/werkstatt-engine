import { test, expect, describe } from "vitest";
import * as mod from "../dht-module.ts";

describe("dht/dht-module", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports createDhtModule", () => {
    expect(typeof mod.createDhtModule).toBe("function");
  });
});
