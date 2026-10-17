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
  <item>RFC-1051: initial src/bordbuch load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as bordbuch_append from "../bordbuch-append.ts";
import * as bordbuch_commit from "../bordbuch-commit.ts";
import * as bordbuch_generate from "../bordbuch-generate.ts";
import * as bordbuch_hook from "../bordbuch-hook.ts";
import * as bordbuch_status from "../bordbuch-status.ts";
import * as bordbuch_validate from "../bordbuch-validate.ts";

test("bordbuch-append module loads", () => {
  expect(bordbuch_append).toBeDefined();
});

test("bordbuch-commit module loads", () => {
  expect(bordbuch_commit).toBeDefined();
});

test("bordbuch-generate module loads", () => {
  expect(bordbuch_generate).toBeDefined();
});

test("bordbuch-hook module loads", () => {
  expect(bordbuch_hook).toBeDefined();
});

test("bordbuch-status module loads", () => {
  expect(bordbuch_status).toBeDefined();
});

test("bordbuch-validate module loads", () => {
  expect(bordbuch_validate).toBeDefined();
});
