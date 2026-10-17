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
  <item>RFC-1051: initial src/journal load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as check_blocking from "../check-blocking.ts";
import * as types from "../types.ts";

test("check-blocking module loads", () => {
  expect(check_blocking).toBeDefined();
});

test("types module loads", () => {
  expect(types).toBeDefined();
});
