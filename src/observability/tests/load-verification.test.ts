/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/observability modules.</purpose>
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
