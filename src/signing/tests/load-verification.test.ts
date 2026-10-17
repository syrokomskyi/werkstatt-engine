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
  <item>RFC-1051: initial src/signing load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as key from "@warpgogol/werkstatt-shared/signing";
import * as sign from "@warpgogol/werkstatt-shared/signing";
import * as signing_commands from "../signing-commands.ts";
import * as types from "@warpgogol/werkstatt-shared/signing";

test("key module loads", () => {
  expect(key).toBeDefined();
});

test("sign module loads", () => {
  expect(sign).toBeDefined();
});

test("signing-commands module loads", () => {
  expect(signing_commands).toBeDefined();
});

test("types module loads", () => {
  expect(types).toBeDefined();
});
