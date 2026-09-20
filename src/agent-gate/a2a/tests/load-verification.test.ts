/*
<MODULE_CONTRACT>
  <purpose>RFC-1114: load verification tests for src/agent-gate/a2a modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1114: initial src/agent-gate/a2a load verification tests.</item>
  <item>RFC-1114: minimal real A2A endpoint + honest agent card</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as handler from "../handler.ts";
import * as protocol from "../protocol.ts";

test("handler module loads", () => {
  expect(handler).toBeDefined();
});

test("protocol module loads", () => {
  expect(protocol).toBeDefined();
});
