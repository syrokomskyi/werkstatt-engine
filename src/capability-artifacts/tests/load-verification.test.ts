/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/capability-artifacts modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/capability-artifacts load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as store from "../store.ts";

test("store module loads", () => {
  expect(store).toBeDefined();
});
