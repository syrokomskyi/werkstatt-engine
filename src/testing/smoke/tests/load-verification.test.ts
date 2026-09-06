/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/testing/smoke modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/testing/smoke load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as types from "../types.ts";

test("types module loads", () => {
  expect(types).toBeDefined();
});
