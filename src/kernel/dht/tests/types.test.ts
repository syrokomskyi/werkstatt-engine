import { test, expect, describe } from "vitest";
import * as mod from "../types.ts";

describe("dht/types", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
