import { test, expect, describe } from "vitest";
import * as mod from "../resolve-compass-scan-root.ts";

describe("kernel/resolve-compass-scan-root", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
