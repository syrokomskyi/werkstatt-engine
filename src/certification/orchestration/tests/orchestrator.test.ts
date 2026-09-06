import { test, expect, describe } from "vitest";
import * as mod from "../orchestrator.ts";

describe("orchestration/orchestrator", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
