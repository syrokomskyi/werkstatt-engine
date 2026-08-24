/*
<MODULE_CONTRACT>
  <purpose>RFC-0866: leitstand.dev-deploy resolves gate decision at conventional path by default; fails when file not found.</purpose>
  <keywords>RFC-0866, leitstand, dev-deploy, gate-decision, conventional path, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: update dev-deploy test to assert --gate-decision requirement.</item>
  <item>RFC-0866 fix D-1: update test for optional --gate-decision with conventional path fallback.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { runLeitstandDevDeploy } from "../leitstand/leitstand-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";

const context = {
  workspaceRoot: "/tmp",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

test("leitstand.dev-deploy fails when gate decision file not found at conventional path", async () => {
  const input: KernelCommandInput = {
    flags: {
      site: "test-sys",
      release: "r000001",
      "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    argv: [],
  };
  await expect(runLeitstandDevDeploy(input, context)).rejects.toThrow(
    "gate decision file not found",
  );
});
