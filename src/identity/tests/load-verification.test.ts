/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/identity modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/identity load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as identity_bootstrap from "../identity-bootstrap.ts";
import * as identity_credential_issue from "../identity-credential-issue.ts";
import * as identity_credential_revoke from "../identity-credential-revoke.ts";
import * as identity_credential_verify from "../identity-credential-verify.ts";
import * as identity_io from "../identity-io.ts";

test("identity-bootstrap module loads", () => {
  expect(identity_bootstrap).toBeDefined();
});

test("identity-credential-issue module loads", () => {
  expect(identity_credential_issue).toBeDefined();
});

test("identity-credential-revoke module loads", () => {
  expect(identity_credential_revoke).toBeDefined();
});

test("identity-credential-verify module loads", () => {
  expect(identity_credential_verify).toBeDefined();
});

test("identity-io module loads", () => {
  expect(identity_io).toBeDefined();
});
