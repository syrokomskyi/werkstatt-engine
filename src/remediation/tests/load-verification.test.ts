/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/remediation modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/remediation load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as remediation_catalog_generate from "../remediation-catalog-generate.ts";
import * as remediation_hint_validate from "../remediation-hint-validate.ts";

test("remediation-catalog-generate module loads", () => {
  expect(remediation_catalog_generate).toBeDefined();
});

test("remediation-hint-validate module loads", () => {
  expect(remediation_hint_validate).toBeDefined();
});
