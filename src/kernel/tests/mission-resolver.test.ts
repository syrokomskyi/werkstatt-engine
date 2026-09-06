import { test, expect, describe } from "vitest";
import * as mod from "../mission-resolver.ts";

describe("kernel/mission-resolver", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
