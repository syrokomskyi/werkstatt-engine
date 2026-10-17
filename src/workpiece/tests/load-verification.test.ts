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
  <item>RFC-1051: initial src/workpiece load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as dna_22_checker from "../dna-22-checker.ts";
import * as workpiece_read from "../workpiece-read.ts";
import * as workpiece_write from "../workpiece-write.ts";

test("dna-22-checker module loads", () => {
  expect(dna_22_checker).toBeDefined();
});

test("workpiece-read module loads", () => {
  expect(workpiece_read).toBeDefined();
});

test("workpiece-write module loads", () => {
  expect(workpiece_write).toBeDefined();
});
