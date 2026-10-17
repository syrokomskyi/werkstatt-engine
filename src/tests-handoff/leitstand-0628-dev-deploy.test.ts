/*
<MODULE_CONTRACT>
  <purpose>RFC-0866: leitstand.dev-deploy resolves gate decision at conventional path by default; fails when file not found.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: update dev-deploy test to assert --gate-decision requirement.</item>
  <item>RFC-0866 fix D-1: update test for optional --gate-decision with conventional path fallback.</item>
  <item>RFC-1190: pass --mission — unresolved mission context now blocks before the gate-decision load under test.</item>
  <item>RFC-1190: restore mission context + evidence archival in release-mode deploys

RFC-1190: precedence-ordered resolveMissionContext (--mission → release build-identity → currentMission), MISSION_CONTEXT_UNRESOLVED/MISMATCH blocking, fail-closed EVIDENCE_SYNC_FAILED with --skip-evidence-sync as sole escape hatch, journaled evidence-sync-* ship steps after each certify-*, evidence.sync --site/--system flag.

2026-10-04 handoff fixes: shared 25min mission.check timeout (inner 5min race + 300s orchestrator raced cold ~7-11min captures), sweep excludeOpIds so mission.close no longer self-abandons the live ship journal (broke --resume), name-keyed journal resume state so closed-mission plan shifts can't skip unexecuted steps, wrangler dev documented as the required --base-url preview server.</item>
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

test("leitstand.dev-deploy fails when gate decision file not found at conventional path", async () => {
  const input: KernelCommandInput = {
    flags: {
      site: "test-sys",
      release: "r000001",
      // RFC-1190: explicit mission context — unresolved context now blocks
      // before the gate-decision load this test exercises.
      mission: "test-sys-m000001",
      "artifact-hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    argv: [],
  };
  await expect(runLeitstandDevDeploy(input, context)).rejects.toThrow(
    "gate decision file not found",
  );
});
