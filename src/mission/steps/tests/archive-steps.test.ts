import { test, expect, describe } from "vitest";
import * as mod from "../archive-steps.ts";

describe("archive-steps", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("buildArchiveSteps returns empty array", async () => {
    const steps = await mod.buildArchiveSteps("/tmp", "m000001", null);
    expect(steps).toEqual([]);
  });
});
