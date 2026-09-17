/*
<MODULE_CONTRACT>
  <purpose>RFC-1104 AC-5: verify every preserved engine package specifier still resolves the sunk contract cluster — retargeted barrels and forwarding modules must surface the same symbols now owned by @warpgogol/werkstatt-shared.</purpose>
  <non-goals>Does not test behavior of the symbols — only that the specifier surface resolves.</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1104: initial barrel-resolution test covering kernel, kernel/types, kernel/workspace-io, runtime/desired-state, schemas, signing, fingerprint, component specifiers.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";

import * as kernelBarrel from "@warpgogol/werkstatt-engine/kernel";
import * as kernelTypes from "@warpgogol/werkstatt-engine/kernel/types";
import * as kernelWorkspaceIo from "@warpgogol/werkstatt-engine/kernel/workspace-io";
import * as runtimeDesiredState from "@warpgogol/werkstatt-engine/runtime/desired-state";
import * as schemasBarrel from "@warpgogol/werkstatt-engine/schemas";
import * as signingBarrel from "@warpgogol/werkstatt-engine/signing";
import * as fingerprintBarrel from "@warpgogol/werkstatt-engine/fingerprint";
import * as componentBarrel from "@warpgogol/werkstatt-engine/component";

test("engine/kernel resolves sunk contract cluster", () => {
  expect(kernelBarrel.writeFileAtomic).toBeTypeOf("function");
  expect(kernelBarrel.diagnosticSchema).toBeDefined();
  expect(kernelBarrel.DIAGNOSTIC_LIMITS).toBeDefined();
});

test("engine/kernel/types forwarding module resolves", () => {
  // original surface: type-only exports + defineKernelConfig (diagnosticSchema lives in kernel/diagnostic, never in types)
  expect(kernelTypes.defineKernelConfig).toBeTypeOf("function");
});

test("engine/kernel/workspace-io forwarding module resolves", () => {
  // original surface: WorkspaceIO contract + IO factories (writeFileAtomic lives in kernel/fs-atomic)
  expect(kernelWorkspaceIo.createDefaultIO).toBeTypeOf("function");
  expect(kernelWorkspaceIo.createRecordingIO).toBeTypeOf("function");
  expect(kernelWorkspaceIo.createReadOnlyIO).toBeTypeOf("function");
  expect(kernelWorkspaceIo.KernelMetaError).toBeTypeOf("function");
});

test("engine/runtime/desired-state forwarding module resolves", () => {
  // type-only module — zero runtime keys; load verification only
  expect(runtimeDesiredState).toBeDefined();
});

test("engine/schemas barrel resolves operations + diagnostic schemas", () => {
  expect(schemasBarrel.systemConfigSchema).toBeDefined();
  expect(schemasBarrel.missionManifestSchema).toBeDefined();
  expect(schemasBarrel.releaseManifestSchema).toBeDefined();
  expect(schemasBarrel.diagnosticSchema).toBeDefined();
  expect(schemasBarrel.STERNSYSTEM_ID_REGEX).toBeInstanceOf(RegExp);
  expect(schemasBarrel.hasTldSuffix).toBeTypeOf("function");
});

test("engine/signing barrel resolves sunk signing core", () => {
  expect(signingBarrel.generateKeyPair).toBeTypeOf("function");
  expect(signingBarrel.signBytes).toBeTypeOf("function");
  expect(signingBarrel.verifyBytes).toBeTypeOf("function");
  expect(signingBarrel.canonicalBytes).toBeTypeOf("function");
});

test("engine/fingerprint barrel resolves sunk primitives + canonical-json", () => {
  expect(fingerprintBarrel.byteHash).toBeTypeOf("function");
  expect(fingerprintBarrel.stableStringify).toBeTypeOf("function");
  expect(fingerprintBarrel.isSha256Digest).toBeTypeOf("function");
  expect(fingerprintBarrel.snapshotCanonicalJsonObjectV1).toBeTypeOf("function");
  expect(fingerprintBarrel.canonicalJsonBytesV1).toBeTypeOf("function");
  expect(fingerprintBarrel.CANONICAL_JSON_V1).toBeDefined();
  // engine-local exports stay
  expect(fingerprintBarrel.hashHtml).toBeTypeOf("function");
});

test("engine/component barrel resolves sunk contracts + local schemas/identity", () => {
  expect(componentBarrel.SCOPE_ERROR_CODES).toBeDefined();
  expect(componentBarrel.parseComponentDeclaration).toBeTypeOf("function");
  expect(componentBarrel.computeManifestHash).toBeTypeOf("function");
});
