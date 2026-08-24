/*
<MODULE_CONTRACT>
  <purpose>RFC-0865: leitstand.pipeline.check returns pipeline steps without transition block.</purpose>
  <keywords>RFC-0865, leitstand, pipeline-check, certification, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: update pipeline-check test to assert successful return with steps.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { runLeitstandPipelineCheck } from "../leitstand/leitstand-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";

const context = {
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
