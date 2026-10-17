/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for leitstand 0842 pipeline check covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: update pipeline-check test to assert successful return with steps.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { runLeitstandPipelineCheck } from "../leitstand/leitstand-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

const context = {
  io: createDefaultIO().io,
  workspaceRoot: "/tmp",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

test("leitstand.pipeline.check returns steps successfully", async () => {
  const input: KernelCommandInput = { flags: { release: "r000001" }, argv: [] };
  const result = await runLeitstandPipelineCheck(input, context);
  expect(result.exitCode).toBe(0);
  expect(result.data!.steps.length).toBeGreaterThan(0);
  expect(result.data!.nextStep).toBeTruthy();
});
