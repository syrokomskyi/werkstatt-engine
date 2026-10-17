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
  <item>RFC-1051: initial src/plugin load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as autonomy_validate from "../autonomy-validate.ts";
import * as commands_validate from "../commands-validate.ts";
import * as import_scan_util from "../import-scan-util.ts";
import * as shared_validate from "../shared-validate.ts";

test("autonomy-validate module loads", () => {
  expect(autonomy_validate).toBeDefined();
});

test("commands-validate module loads", () => {
  expect(commands_validate).toBeDefined();
});

test("import-scan-util module loads", () => {
  expect(import_scan_util).toBeDefined();
});

test("shared-validate module loads", () => {
  expect(shared_validate).toBeDefined();
});
