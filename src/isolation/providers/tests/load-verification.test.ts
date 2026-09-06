/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/isolation/providers modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/isolation/providers load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as fake_sandbox from "../fake-sandbox.ts";

test("fake-sandbox module loads", () => {
  expect(fake_sandbox).toBeDefined();
});
