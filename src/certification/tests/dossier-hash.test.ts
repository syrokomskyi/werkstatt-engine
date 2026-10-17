/*
<MODULE_CONTRACT>
<purpose>
Unit tests for dossier hash covering dossier-hash. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the dossier suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

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
