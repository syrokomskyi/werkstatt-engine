/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/agent-gate/mcp modules.</purpose>
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
