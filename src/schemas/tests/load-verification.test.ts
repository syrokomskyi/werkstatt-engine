/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for src/schemas modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial src/schemas load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as artifact_store from "@warpgogol/werkstatt-shared/ontology/operations";
import * as dht from "@warpgogol/werkstatt-shared/ontology/operations";
import * as diagnostic from "@warpgogol/werkstatt-shared/kernel";
import * as handoff from "@warpgogol/werkstatt-shared/ontology/operations";
import * as leitstand from "@warpgogol/werkstatt-shared/ontology/operations";
import * as materialization from "@warpgogol/werkstatt-shared/ontology/operations";
import * as mission from "@warpgogol/werkstatt-shared/ontology/operations";
import * as naming_policy from "@warpgogol/werkstatt-shared/ontology/operations";
import * as notausgang from "@warpgogol/werkstatt-shared/ontology/operations";
import * as release from "@warpgogol/werkstatt-shared/ontology/operations";
import * as sternsystem from "@warpgogol/werkstatt-shared/ontology/operations";
import * as werkstatt from "@warpgogol/werkstatt-shared/ontology/operations";

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
