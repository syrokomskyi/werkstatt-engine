/*
<MODULE_CONTRACT>
  <purpose>RFC-0866: leitstand.propagate auto-resolves --gate-decision from conventional path.</purpose>
  <keywords>RFC-0866, leitstand, propagate, certification, gate-decision, warning-only, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: update propagate warning-only test to assert --gate-decision requirement.</item>
  <item>RFC-0866: update test — --gate-decision is now optional with conventional path fallback.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { runLeitstandPropagate } from "../leitstand/leitstand-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";

const context = {
  workspaceRoot: "/tmp",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

test("leitstand.propagate (warning-only) auto-resolves gate-decision from conventional path", async () => {
  const input: KernelCommandInput = { flags: { release: "r000001", site: "test-sys" }, argv: [] };
  // --gate-decision is now optional; auto-resolved from
  // systems-cache/{system}/gate-decisions/{release}-alt.json
  // With no file at that path, the error will come from loading the decision.
  await expect(runLeitstandPropagate(input, context)).rejects.toThrow();
});
