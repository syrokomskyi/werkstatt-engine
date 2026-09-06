/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for handoff modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial handoff load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as absorbReport from "../absorb-report.ts";
import * as authoredSet from "../authored-set.ts";
import * as buildPipelineHelpers from "../build-pipeline-helpers.ts";
import * as bundleIo from "../bundle-io.ts";
import * as capabilityDiff from "../capability-diff.ts";
import * as derivedEdits from "../derived-edits.ts";
import * as guards from "../guards.ts";
import * as handoffAbsorb from "../handoff-absorb.ts";
import * as handoffPack from "../handoff-pack.ts";
import * as handoffValidate from "../handoff-validate.ts";
import * as identityModule from "../identity-module.ts";
import * as materialize from "../materialize.ts";
import * as migratorRegistryValidate from "../migrator-registry-validate.ts";
import * as platformConsistency from "../platform-consistency.ts";
import * as platformModule from "../platform-module.ts";
import * as platformScope from "../platform-scope.ts";
import * as semver from "../semver.ts";
import * as surfaceContract from "../surface-contract.ts";
import * as types from "../types.ts";
import * as validationPack from "../validation-pack.ts";
import * as versionCompare from "../version-compare.ts";

test("absorb-report module loads", () => {
  expect(absorbReport).toBeDefined();
});

test("authored-set module loads", () => {
  expect(authoredSet).toBeDefined();
});

test("build-pipeline-helpers module loads", () => {
  expect(buildPipelineHelpers).toBeDefined();
});

test("bundle-io module loads", () => {
  expect(bundleIo).toBeDefined();
});

test("capability-diff module loads", () => {
  expect(capabilityDiff).toBeDefined();
});

test("derived-edits module loads", () => {
  expect(derivedEdits).toBeDefined();
});

test("guards module loads", () => {
  expect(guards).toBeDefined();
});

test("handoff-absorb module loads", () => {
  expect(handoffAbsorb).toBeDefined();
});

test("handoff-pack module loads", () => {
  expect(handoffPack).toBeDefined();
});

test("handoff-validate module loads", () => {
  expect(handoffValidate).toBeDefined();
});

test("identity-module module loads", () => {
  expect(identityModule).toBeDefined();
});

test("materialize module loads", () => {
  expect(materialize).toBeDefined();
});

test("migrator-registry-validate module loads", () => {
  expect(migratorRegistryValidate).toBeDefined();
});

test("platform-consistency module loads", () => {
  expect(platformConsistency).toBeDefined();
});

test("platform-module module loads", () => {
  expect(platformModule).toBeDefined();
});

test("platform-scope module loads", () => {
  expect(platformScope).toBeDefined();
});

test("semver module loads", () => {
  expect(semver).toBeDefined();
});

test("surface-contract module loads", () => {
  expect(surfaceContract).toBeDefined();
});

test("types module loads", () => {
  expect(types).toBeDefined();
});

test("validation-pack module loads", () => {
  expect(validationPack).toBeDefined();
});

test("version-compare module loads", () => {
  expect(versionCompare).toBeDefined();
});
