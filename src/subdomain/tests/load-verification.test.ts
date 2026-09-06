/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/subdomain modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/subdomain load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as subdomain_helpers from "../subdomain-helpers.ts";
import * as subdomain_list from "../subdomain-list.ts";
import * as subdomain_register from "../subdomain-register.ts";
import * as subdomain_validate from "../subdomain-validate.ts";

test("subdomain-helpers module loads", () => {
  expect(subdomain_helpers).toBeDefined();
});

test("subdomain-list module loads", () => {
  expect(subdomain_list).toBeDefined();
});

test("subdomain-register module loads", () => {
  expect(subdomain_register).toBeDefined();
});

test("subdomain-validate module loads", () => {
  expect(subdomain_validate).toBeDefined();
});
