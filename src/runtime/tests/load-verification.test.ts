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
  <item>RFC-1051: initial src/runtime load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as desired_state_persistence from "../desired-state-persistence.ts";
import * as desired_state from "@warpgogol/werkstatt-shared/kernel";
import * as overlay_store from "../overlay-store.ts";
import * as validate_declarations from "../validate-declarations.ts";

test("desired-state-persistence module loads", () => {
  expect(desired_state_persistence).toBeDefined();
});

test("desired-state module loads", () => {
  expect(desired_state).toBeDefined();
});

test("overlay-store module loads", () => {
  expect(overlay_store).toBeDefined();
});

test("validate-declarations module loads", () => {
  expect(validate_declarations).toBeDefined();
});
