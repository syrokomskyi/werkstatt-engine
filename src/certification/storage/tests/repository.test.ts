import { test, expect, describe } from "vitest";
import * as mod from "../repository.ts";

describe("storage/repository", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
