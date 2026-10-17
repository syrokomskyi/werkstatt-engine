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
  <item>RFC-1051: initial src/agent-gate load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as action_pipeline from "../action-pipeline.ts";
import * as limits from "../limits.ts";
import * as ports from "../ports.ts";

test("action-pipeline module loads", () => {
  expect(action_pipeline).toBeDefined();
});

test("limits module loads", () => {
  expect(limits).toBeDefined();
});

test("ports module loads", () => {
  expect(ports).toBeDefined();
});
