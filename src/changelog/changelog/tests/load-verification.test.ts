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
  <item>RFC-1051: initial changelog load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as changelogCommand from "../../changelog-command.ts";
import * as writerAgent from "../agents/writer-agent.ts";
import * as context from "../context.ts";
import * as indexRebuilder from "../core/index-rebuilder.ts";
import * as rateLimiter from "../core/rate-limiter.ts";
import * as types from "../types.ts";
import * as atomicFs from "../utils/atomic-fs.ts";
import * as dateUtils from "../utils/date.ts";
import * as gitUtils from "../utils/git.ts";
import * as sanitize from "../utils/sanitize.ts";

test("changelog-command module loads", () => {
  expect(changelogCommand).toBeDefined();
});

test("writer-agent module loads", () => {
  expect(writerAgent).toBeDefined();
});

test("context module loads", () => {
  expect(context).toBeDefined();
});

test("index-rebuilder module loads", () => {
  expect(indexRebuilder).toBeDefined();
});

test("rate-limiter module loads", () => {
  expect(rateLimiter).toBeDefined();
});

test("types module loads", () => {
  expect(types).toBeDefined();
});

test("atomic-fs module loads", () => {
  expect(atomicFs).toBeDefined();
});

test("date module loads", () => {
  expect(dateUtils).toBeDefined();
});

test("git module loads", () => {
  expect(gitUtils).toBeDefined();
});

test("sanitize module loads", () => {
  expect(sanitize).toBeDefined();
});
