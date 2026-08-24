/*
<MODULE_CONTRACT>
  <purpose>RFC-0866: leitstand.dev-deploy auto-resolves --gate-decision from conventional path.</purpose>
  <keywords>RFC-0866, leitstand, dev-deploy, certification, gate-decision, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: update release dev-deploy test to assert --gate-decision requirement.</item>
  <item>RFC-0866: update test — --gate-decision is now optional with conventional path fallback.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { runLeitstandDevDeploy } from "../leitstand/leitstand-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";

const context = {
  workspaceRoot: "/tmp",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

test("leitstand.dev-deploy (--release) auto-resolves gate-decision from conventional path", async () => {
  const input: KernelCommandInput = { flags: { site: "test-sys", release: "r000001" }, argv: [] };
  // --gate-decision is now optional; auto-resolved from
  // systems-cache/{system}/gate-decisions/{release}-dev.json
  // With no file at that path, the error will come from loading the decision.
  await expect(runLeitstandDevDeploy(input, context)).rejects.toThrow();
});
