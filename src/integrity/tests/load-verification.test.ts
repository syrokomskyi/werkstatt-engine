/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for integrity modules that are CLI runners or complex orchestrators.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial integrity load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as build from "../build.ts";
import * as git from "../git.ts";
import * as manifests from "../manifests.ts";
import * as registry from "../registry.ts";
import * as signing from "../signing.ts";
import * as verify from "../verify.ts";
import * as policy from "../policy.ts";
import * as moveDetection from "../move-detection.ts";
import * as schemaValidation from "../schema-validation.ts";
import * as internalDist from "../internal-dist.ts";
import * as compassAuditHelpers from "../compass-audit-helpers.ts";
import * as integrityCommands from "../integrity-commands.ts";
import * as runInit from "../run-init.ts";
import * as runUpdate from "../run-update.ts";
import * as runVerify from "../run-verify.ts";
import * as runBackfillRevisions from "../run-backfill-revisions.ts";
import * as runRecordBuild from "../run-record-build.ts";
import * as moduleMod from "../module.ts";

test("build module loads without error", () => {
  expect(build).toBeDefined();
  expect(typeof build.collectBuildOutputs).toBe("function");
  expect(typeof build.buildInputsDigest).toBe("function");
});

test("git module loads without error", () => {
  expect(git).toBeDefined();
  expect(typeof git.getTrackedFiles).toBe("function");
});

test("manifests module loads without error", () => {
  expect(manifests).toBeDefined();
  expect(typeof manifests.createEmptyManifest).toBe("function");
  expect(typeof manifests.upsertManifestRecord).toBe("function");
});

test("registry module loads without error", () => {
  expect(registry).toBeDefined();
  expect(typeof registry.bindPath).toBe("function");
});

test("signing module loads without error", () => {
  expect(signing).toBeDefined();
  expect(typeof signing.requireEnv).toBe("function");
});

test("verify module loads without error", () => {
  expect(verify).toBeDefined();
  expect(typeof verify.verifyIntegrity).toBe("function");
});

test("policy module loads without error", () => {
  expect(policy).toBeDefined();
  expect(typeof policy.loadPolicy).toBe("function");
  expect(typeof policy.isManagedPath).toBe("function");
});

test("move-detection module loads without error", () => {
  expect(moveDetection).toBeDefined();
});

test("schema-validation module loads without error", () => {
  expect(schemaValidation).toBeDefined();
});

test("internal-dist module loads without error", () => {
  expect(internalDist).toBeDefined();
});

test("compass-audit-helpers module loads without error", () => {
  expect(compassAuditHelpers).toBeDefined();
});

test("integrity-commands module loads without error", () => {
  expect(integrityCommands).toBeDefined();
});

test("run-init module loads without error", () => {
  expect(runInit).toBeDefined();
});

test("run-update module loads without error", () => {
  expect(runUpdate).toBeDefined();
});

test("run-verify module loads without error", () => {
  expect(runVerify).toBeDefined();
});

test("run-backfill-revisions module loads without error", () => {
  expect(runBackfillRevisions).toBeDefined();
});

test("run-record-build module loads without error", () => {
  expect(runRecordBuild).toBeDefined();
});

test("integrity module loads without error", () => {
  expect(moduleMod).toBeDefined();
});
