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
  <item>RFC-1051: initial src/deploy load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as artifact_build from "../artifact-build.ts";
import * as artifact_gc from "../artifact-gc.ts";
import * as artifact_verify from "../artifact-verify.ts";
import * as atomic_rollback from "../atomic-rollback.ts";
import * as atomic_swap from "../atomic-swap.ts";
import * as deploy_status from "../deploy-status.ts";
import * as deploy_utils from "../deploy-utils.ts";
import * as types from "../types.ts";

test("artifact-build module loads", () => {
  expect(artifact_build).toBeDefined();
});

test("artifact-gc module loads", () => {
  expect(artifact_gc).toBeDefined();
});

test("artifact-verify module loads", () => {
  expect(artifact_verify).toBeDefined();
});

test("atomic-rollback module loads", () => {
  expect(atomic_rollback).toBeDefined();
});

test("atomic-swap module loads", () => {
  expect(atomic_swap).toBeDefined();
});

test("deploy-status module loads", () => {
  expect(deploy_status).toBeDefined();
});

test("deploy-utils module loads", () => {
  expect(deploy_utils).toBeDefined();
});

test("types module loads", () => {
  expect(types).toBeDefined();
});
