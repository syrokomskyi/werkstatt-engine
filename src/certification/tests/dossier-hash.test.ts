import { test, expect, describe } from "vitest";
import * as mod from "../dossier-hash.ts";

describe("dossier-hash", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports computeDossierEventHash", () => {
    expect(typeof mod.computeDossierEventHash).toBe("function");
  });

  test("exports computeDossierRoot", () => {
    expect(typeof mod.computeDossierRoot).toBe("function");
  });

  test("computeDossierRoot returns a string hash", () => {
    const hash = mod.computeDossierRoot("cand-001", []);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});
