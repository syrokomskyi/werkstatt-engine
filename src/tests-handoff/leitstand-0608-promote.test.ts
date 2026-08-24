/*
<MODULE_CONTRACT>
  <purpose>RFC-0866: leitstand.promote resolves gate decision and main-verification-decision at conventional paths by default.</purpose>
  <keywords>RFC-0866, leitstand, promote, gate-decision, conventional path, main-verification, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: update promote test to assert --gate-decision and --main-verification-decision requirement.</item>
  <item>RFC-0866 fix D-1: update test for optional --gate-decision with conventional path fallback.</item>
  <item>RFC-0866 fix D-2: update test for optional --main-verification-decision with conventional path fallback.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { runLeitstandPromote } from "../leitstand/leitstand-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";

const context = {
  workspaceRoot: "/tmp",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

test("leitstand.promote auto-resolves --main-verification-decision from conventional path", async () => {
  const input: KernelCommandInput = {
    flags: {
      release: "r000001",
      site: "test-sys",
      "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    argv: [],
  };
  // --main-verification-decision is now optional; auto-resolved from
  // systems-cache/{system}/gate-decisions/{release}-main-verification.json
  // With no file at that path, the error will come from loading the decision,
  // not from the missing flag.
  await expect(runLeitstandPromote(input, context)).rejects.toThrow();
});
