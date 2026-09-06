/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/journal modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/journal load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as check_blocking from "../check-blocking.ts";
import * as types from "../types.ts";

test("check-blocking module loads", () => {
  expect(check_blocking).toBeDefined();
});

test("types module loads", () => {
  expect(types).toBeDefined();
});
