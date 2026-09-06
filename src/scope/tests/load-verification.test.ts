/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/scope modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/scope load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as scope_commands from "../scope-commands.ts";
import * as scope from "../scope.ts";

test("scope-commands module loads", () => {
  expect(scope_commands).toBeDefined();
});

test("scope module loads", () => {
  expect(scope).toBeDefined();
});
