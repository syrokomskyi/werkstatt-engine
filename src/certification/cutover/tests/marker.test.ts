import { test, expect, describe } from "vitest";
import * as mod from "../marker.ts";

describe("cutover/marker", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
