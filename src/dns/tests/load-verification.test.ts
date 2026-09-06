/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/dns modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/dns load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as dns_record_delete from "../dns-record-delete.ts";
import * as dns_record_list from "../dns-record-list.ts";
import * as dns_record_validate from "../dns-record-validate.ts";

test("dns-record-delete module loads", () => {
  expect(dns_record_delete).toBeDefined();
});

test("dns-record-list module loads", () => {
  expect(dns_record_list).toBeDefined();
});

test("dns-record-validate module loads", () => {
  expect(dns_record_validate).toBeDefined();
});
