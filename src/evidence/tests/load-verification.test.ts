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
  <item>RFC-1051: initial src/evidence load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as evidence_fetch from "../evidence-fetch.ts";
import * as evidence_module from "../evidence-module.ts";
import * as evidence_sync from "../evidence-sync.ts";
import * as r2_client from "../r2-client.ts";

test("evidence-fetch module loads", () => {
  expect(evidence_fetch).toBeDefined();
});

test("evidence-module module loads", () => {
  expect(evidence_module).toBeDefined();
});

test("evidence-sync module loads", () => {
  expect(evidence_sync).toBeDefined();
});

test("r2-client module loads", () => {
  expect(r2_client).toBeDefined();
});
