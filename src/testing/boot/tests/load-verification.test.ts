/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/testing/boot modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/testing/boot load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as types from "../types.ts";

test("types module loads", () => {
  expect(types).toBeDefined();
});
