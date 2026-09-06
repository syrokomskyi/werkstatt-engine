import { test, expect, describe } from "vitest";
import * as mod from "../fs-idempotent.ts";

describe("kernel/fs-idempotent", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
