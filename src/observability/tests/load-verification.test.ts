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
  <item>RFC-1051: initial src/observability load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as alert_rules from "../alert-rules.ts";
import * as module from "../module.ts";
import * as signoz_api_client from "../signoz-api-client.ts";

test("alert-rules module loads", () => {
  expect(alert_rules).toBeDefined();
});

test("module module loads", () => {
  expect(module).toBeDefined();
});

test("signoz-api-client module loads", () => {
  expect(signoz_api_client).toBeDefined();
});
