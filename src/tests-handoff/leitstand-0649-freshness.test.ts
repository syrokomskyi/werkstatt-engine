/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for leitstand 0649 freshness covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: update freshness dev-deploy test to assert --gate-decision requirement.</item>
  <item>RFC-0866: update test — --gate-decision is now optional with conventional path fallback.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { runLeitstandDevDeploy } from "../leitstand/leitstand-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

const context = {
  io: createDefaultIO().io,
  workspaceRoot: "/tmp",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

test("leitstand.dev-deploy (freshness) requires --release", async () => {
  const input: KernelCommandInput = { flags: { site: "test-sys" }, argv: [] };
  await expect(runLeitstandDevDeploy(input, context)).rejects.toThrow("--release is required");
});
