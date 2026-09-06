/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/evolution modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/evolution load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as canary_router from "../canary-router.ts";
import * as contracts from "../contracts.ts";
import * as controller from "../controller.ts";
import * as evolution_commands from "../evolution-commands.ts";
import * as guards from "../guards.ts";
import * as health_monitor from "../health-monitor.ts";
import * as reducer from "../reducer.ts";
import * as shadow_executor from "../shadow-executor.ts";

test("canary-router module loads", () => {
  expect(canary_router).toBeDefined();
});

test("contracts module loads", () => {
  expect(contracts).toBeDefined();
});

test("controller module loads", () => {
  expect(controller).toBeDefined();
});

test("evolution-commands module loads", () => {
  expect(evolution_commands).toBeDefined();
});

test("guards module loads", () => {
  expect(guards).toBeDefined();
});

test("health-monitor module loads", () => {
  expect(health_monitor).toBeDefined();
});

test("reducer module loads", () => {
  expect(reducer).toBeDefined();
});

test("shadow-executor module loads", () => {
  expect(shadow_executor).toBeDefined();
});
