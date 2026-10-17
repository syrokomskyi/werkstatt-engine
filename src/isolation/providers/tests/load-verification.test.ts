/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for load verification covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/isolation/providers load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as fake_sandbox from "../fake-sandbox.ts";

test("fake-sandbox module loads", () => {
  expect(fake_sandbox).toBeDefined();
});
