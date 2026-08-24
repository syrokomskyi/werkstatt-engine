/*
<MODULE_CONTRACT>
  <purpose>RFC-0866: leitstand.propagate resolves gate decision at conventional path by default; fails when file not found.</purpose>
  <keywords>RFC-0866, leitstand, propagate, gate-decision, conventional path, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: update propagate test to assert --gate-decision requirement.</item>
  <item>RFC-0866 fix D-1: update test for optional --gate-decision with conventional path fallback.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { runLeitstandPropagate } from "../leitstand/leitstand-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";

const context = {
  workspaceRoot: "/tmp",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

test("leitstand.propagate fails when gate decision file not found at conventional path", async () => {
  const input: KernelCommandInput = {
    flags: {
      release: "r000001",
      site: "test-sys",
      "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    argv: [],
  };
  await expect(runLeitstandPropagate(input, context)).rejects.toThrow(
    "gate decision file not found",
  );
});
