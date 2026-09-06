/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/leitstand modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/leitstand load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as adapter from "../adapter.ts";
import * as cache_purge from "../cache-purge.ts";
import * as certify from "../certify.ts";
import * as deploy_execution from "../deploy-execution.ts";
import * as leitstand_commands from "../leitstand-commands.ts";
import * as service_dev_deploy from "../service-dev-deploy.ts";
import * as service_promote from "../service-promote.ts";
import * as ship from "../ship.ts";
import * as test_evidence_gate from "../test-evidence-gate.ts";

test("adapter module loads", () => {
  expect(adapter).toBeDefined();
});

test("cache-purge module loads", () => {
  expect(cache_purge).toBeDefined();
});

test("certify module loads", () => {
  expect(certify).toBeDefined();
});

test("deploy-execution module loads", () => {
  expect(deploy_execution).toBeDefined();
});

test("leitstand-commands module loads", () => {
  expect(leitstand_commands).toBeDefined();
});

test("service-dev-deploy module loads", () => {
  expect(service_dev_deploy).toBeDefined();
});

test("service-promote module loads", () => {
  expect(service_promote).toBeDefined();
});

test("ship module loads", () => {
  expect(ship).toBeDefined();
});

test("test-evidence-gate module loads", () => {
  expect(test_evidence_gate).toBeDefined();
});
