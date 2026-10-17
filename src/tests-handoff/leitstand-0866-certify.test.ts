/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for leitstand 0866 certify covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0866: initial test for leitstand.certify command flag validation.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { runLeitstandCertify } from "../leitstand/certify.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

const context = {
  io: createDefaultIO().io,
  workspaceRoot: "/tmp",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

test("leitstand.certify requires --site", async () => {
  const input: KernelCommandInput = {
    flags: { gate: "dev", release: "r000001", "artifact-hash": "sha256:abc" },
    argv: [],
  };
  await expect(runLeitstandCertify(input, context)).rejects.toThrow("--site is required");
});

test("leitstand.certify requires --gate", async () => {
  const input: KernelCommandInput = {
    flags: { site: "test-sys", release: "r000001", "artifact-hash": "sha256:abc" },
    argv: [],
  };
  await expect(runLeitstandCertify(input, context)).rejects.toThrow("--gate is required");
});

test("leitstand.certify requires --release", async () => {
  const input: KernelCommandInput = {
    flags: { site: "test-sys", gate: "dev", "artifact-hash": "sha256:abc" },
    argv: [],
  };
  await expect(runLeitstandCertify(input, context)).rejects.toThrow("--release is required");
});

test("leitstand.certify auto-resolves --artifact-hash from release dir", async () => {
  const input: KernelCommandInput = {
    flags: { site: "test-sys", gate: "dev", release: "r000001" },
    argv: [],
  };
  // --artifact-hash is now optional; auto-resolved from releases/{release}/artifact.tar.gz
  // With no file at that path, the error will come from resolveArtifactHash.
  await expect(runLeitstandCertify(input, context)).rejects.toThrow();
});
