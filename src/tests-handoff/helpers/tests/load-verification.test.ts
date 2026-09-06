/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/tests-handoff/helpers modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/tests-handoff/helpers load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as cloudflare_api_mock from "../cloudflare-api-mock.ts";
import * as kernel_result_helpers from "../kernel-result-helpers.ts";
import * as leitstand_fixture from "../leitstand-fixture.ts";
import * as materialize_fixture from "../materialize-fixture.ts";
import * as registry_builder from "../registry-builder.ts";
import * as transition_block_helpers from "../transition-block-helpers.ts";

test("cloudflare-api-mock module loads", () => {
  expect(cloudflare_api_mock).toBeDefined();
});

test("kernel-result-helpers module loads", () => {
  expect(kernel_result_helpers).toBeDefined();
});

test("leitstand-fixture module loads", () => {
  expect(leitstand_fixture).toBeDefined();
});

test("materialize-fixture module loads", () => {
  expect(materialize_fixture).toBeDefined();
});

test("registry-builder module loads", () => {
  expect(registry_builder).toBeDefined();
});

test("transition-block-helpers module loads", () => {
  expect(transition_block_helpers).toBeDefined();
});
