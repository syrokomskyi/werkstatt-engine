import { test, expect, describe } from "vitest";
import * as mod from "../schemas.ts";

describe("profile/schemas", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
