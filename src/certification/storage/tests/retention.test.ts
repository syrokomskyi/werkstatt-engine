import { test, expect, describe } from "vitest";
import * as mod from "../retention.ts";

describe("storage/retention", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
