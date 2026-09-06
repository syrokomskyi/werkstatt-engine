/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for sternsystem modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial sternsystem load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as externalEditCollector from "../external-edit-collector.ts";
import * as pinHelpers from "../pin-helpers.ts";
import * as sternsystemDiscover from "../sternsystem-discover.ts";
import * as sternsystemExtract from "../sternsystem-extract.ts";
import * as sternsystemHandoverCancel from "../sternsystem-handover-cancel.ts";
import * as sternsystemList from "../sternsystem-list.ts";
import * as sternsystemPassportGenerate from "../sternsystem-passport-generate.ts";
import * as sternsystemPassportVerify from "../sternsystem-passport-verify.ts";
import * as sternsystemPin from "../sternsystem-pin.ts";
import * as sternsystemRegister from "../sternsystem-register.ts";
import * as sternsystemStatus from "../sternsystem-status.ts";

test("external-edit-collector module loads", () => {
  expect(externalEditCollector).toBeDefined();
});

test("pin-helpers module loads", () => {
  expect(pinHelpers).toBeDefined();
});

test("sternsystem-discover module loads", () => {
  expect(sternsystemDiscover).toBeDefined();
});

test("sternsystem-extract module loads", () => {
  expect(sternsystemExtract).toBeDefined();
});

test("sternsystem-handover-cancel module loads", () => {
  expect(sternsystemHandoverCancel).toBeDefined();
});

test("sternsystem-list module loads", () => {
  expect(sternsystemList).toBeDefined();
});

test("sternsystem-passport-generate module loads", () => {
  expect(sternsystemPassportGenerate).toBeDefined();
});

test("sternsystem-passport-verify module loads", () => {
  expect(sternsystemPassportVerify).toBeDefined();
});

test("sternsystem-pin module loads", () => {
  expect(sternsystemPin).toBeDefined();
});

test("sternsystem-register module loads", () => {
  expect(sternsystemRegister).toBeDefined();
});

test("sternsystem-status module loads", () => {
  expect(sternsystemStatus).toBeDefined();
});
