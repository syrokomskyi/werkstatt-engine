/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/schemas modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/schemas load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as artifact_store from "../artifact-store.ts";
import * as dht from "../dht.ts";
import * as diagnostic from "../diagnostic.ts";
import * as handoff from "../handoff.ts";
import * as leitstand from "../leitstand.ts";
import * as materialization from "../materialization.ts";
import * as mission from "../mission.ts";
import * as naming_policy from "../naming-policy.ts";
import * as notausgang from "../notausgang.ts";
import * as release from "../release.ts";
import * as sternsystem from "../sternsystem.ts";
import * as werkstatt from "../werkstatt.ts";

test("artifact-store module loads", () => {
  expect(artifact_store).toBeDefined();
});

test("dht module loads", () => {
  expect(dht).toBeDefined();
});

test("diagnostic module loads", () => {
  expect(diagnostic).toBeDefined();
});

test("handoff module loads", () => {
  expect(handoff).toBeDefined();
});

test("leitstand module loads", () => {
  expect(leitstand).toBeDefined();
});

test("materialization module loads", () => {
  expect(materialization).toBeDefined();
});

test("mission module loads", () => {
  expect(mission).toBeDefined();
});

test("naming-policy module loads", () => {
  expect(naming_policy).toBeDefined();
});

test("notausgang module loads", () => {
  expect(notausgang).toBeDefined();
});

test("release module loads", () => {
  expect(release).toBeDefined();
});

test("sternsystem module loads", () => {
  expect(sternsystem).toBeDefined();
});

test("werkstatt module loads", () => {
  expect(werkstatt).toBeDefined();
});
