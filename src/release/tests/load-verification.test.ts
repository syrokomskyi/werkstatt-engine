/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/release modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/release load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as boot_smoke from "../boot-smoke.ts";
import * as release_commands from "../release-commands.ts";

test("boot-smoke module loads", () => {
  expect(boot_smoke).toBeDefined();
});

test("release-commands module loads", () => {
  expect(release_commands).toBeDefined();
});
