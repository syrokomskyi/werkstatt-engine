import { test, expect, describe } from "vitest";
import * as mod from "../adapter.ts";

describe("storage/adapter", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
