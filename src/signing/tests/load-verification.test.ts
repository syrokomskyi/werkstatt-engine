/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/signing modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/signing load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as key from "../key.ts";
import * as sign from "../sign.ts";
import * as signing_commands from "../signing-commands.ts";
import * as types from "../types.ts";

test("key module loads", () => {
  expect(key).toBeDefined();
});

test("sign module loads", () => {
  expect(sign).toBeDefined();
});

test("signing-commands module loads", () => {
  expect(signing_commands).toBeDefined();
});

test("types module loads", () => {
  expect(types).toBeDefined();
});
