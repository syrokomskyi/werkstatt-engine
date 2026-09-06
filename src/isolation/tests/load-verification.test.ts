/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/isolation modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/isolation load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as capability_bridge from "../capability-bridge.ts";
import * as conformance from "../conformance.ts";
import * as contracts from "../contracts.ts";
import * as isolation_commands from "../isolation-commands.ts";
import * as schemas from "../schemas.ts";

test("capability-bridge module loads", () => {
  expect(capability_bridge).toBeDefined();
});

test("conformance module loads", () => {
  expect(conformance).toBeDefined();
});

test("contracts module loads", () => {
  expect(contracts).toBeDefined();
});

test("isolation-commands module loads", () => {
  expect(isolation_commands).toBeDefined();
});

test("schemas module loads", () => {
  expect(schemas).toBeDefined();
});
