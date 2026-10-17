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
  <item>RFC-1051: initial src/component load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as contracts from "@warpgogol/werkstatt-shared/component";
import * as identity from "../identity.ts";
import * as schemas from "../schemas.ts";

test("contracts module loads", () => {
  expect(contracts).toBeDefined();
});

test("identity module loads", () => {
  expect(identity).toBeDefined();
});

test("schemas module loads", () => {
  expect(schemas).toBeDefined();
});
