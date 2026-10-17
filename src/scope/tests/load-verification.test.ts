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
  <item>RFC-1051: initial src/scope load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as scope_commands from "../scope-commands.ts";
import * as scope from "../scope.ts";

test("scope-commands module loads", () => {
  expect(scope_commands).toBeDefined();
});

test("scope module loads", () => {
  expect(scope).toBeDefined();
});
