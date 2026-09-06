/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/component modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/component load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as contracts from "../contracts.ts";
import * as identity from "../identity.ts";
import * as schemas from "../schemas.ts";

test("contracts module loads", () => {
  expect(contracts).toBeDefined();
});

test("identity module loads", () => {
  expect(identity).toBeDefined();
});

test("schemas module loads", () => {
  expect(schemas).toBeDefined();
});
