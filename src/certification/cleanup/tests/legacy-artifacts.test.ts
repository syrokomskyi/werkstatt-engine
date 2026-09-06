import { test, expect, describe } from "vitest";
import * as mod from "../legacy-artifacts.ts";

describe("cleanup/legacy-artifacts", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
