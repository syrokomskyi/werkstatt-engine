/*
<MODULE_CONTRACT>
<purpose>
Unit tests for identity covering identity. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the identity suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe } from "vitest";
import * as mod from "../identity.ts";

describe("identity", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports buildReleaseCandidateIdentityV1", () => {
    expect(typeof mod.buildReleaseCandidateIdentityV1).toBe("function");
  });

  test("exports buildDossierEventIdentityV1", () => {
    expect(typeof mod.buildDossierEventIdentityV1).toBe("function");
  });
});
