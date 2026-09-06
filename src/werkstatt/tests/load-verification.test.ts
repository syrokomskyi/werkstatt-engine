/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/werkstatt modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/werkstatt load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as atomic from "../atomic.ts";
import * as git_exec from "../git-exec.ts";
import * as lock from "../lock.ts";
import * as operation from "../operation.ts";
import * as werkstatt_commit from "../werkstatt-commit.ts";
import * as werkstatt_lock_recover from "../werkstatt-lock-recover.ts";
import * as werkstatt_lock_status from "../werkstatt-lock-status.ts";

test("atomic module loads", () => {
  expect(atomic).toBeDefined();
});

test("git-exec module loads", () => {
  expect(git_exec).toBeDefined();
});

test("lock module loads", () => {
  expect(lock).toBeDefined();
});

test("operation module loads", () => {
  expect(operation).toBeDefined();
});

test("werkstatt-commit module loads", () => {
  expect(werkstatt_commit).toBeDefined();
});

test("werkstatt-lock-recover module loads", () => {
  expect(werkstatt_lock_recover).toBeDefined();
});

test("werkstatt-lock-status module loads", () => {
  expect(werkstatt_lock_status).toBeDefined();
});
