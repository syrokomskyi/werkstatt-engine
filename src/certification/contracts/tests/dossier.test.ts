import { test, expect, describe } from "vitest";
import * as mod from "../dossier.ts";

describe("contracts/dossier", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });
});
