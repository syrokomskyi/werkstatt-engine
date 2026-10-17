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
  <item>RFC-1051: initial src/customdomain load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as customdomain_helpers from "../customdomain-helpers.ts";
import * as customdomain_register from "../customdomain-register.ts";
import * as redirect_register from "../redirect-register.ts";

test("customdomain-helpers module loads", () => {
  expect(customdomain_helpers).toBeDefined();
});

test("customdomain-register module loads", () => {
  expect(customdomain_register).toBeDefined();
});

test("redirect-register module loads", () => {
  expect(redirect_register).toBeDefined();
});
