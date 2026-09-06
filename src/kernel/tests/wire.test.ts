import { test, expect, describe } from "vitest";
import * as mod from "../wire.ts";

describe("kernel/wire", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
