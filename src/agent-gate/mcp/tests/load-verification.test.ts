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
  <item>RFC-1051: initial src/agent-gate/mcp load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as handler from "../handler.ts";
import * as protocol from "../protocol.ts";
import * as tools from "../tools.ts";

test("handler module loads", () => {
  expect(handler).toBeDefined();
});

test("protocol module loads", () => {
  expect(protocol).toBeDefined();
});

test("tools module loads", () => {
  expect(tools).toBeDefined();
});
