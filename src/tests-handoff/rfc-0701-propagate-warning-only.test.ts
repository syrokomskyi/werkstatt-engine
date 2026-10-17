/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for rfc 0701 propagate warning only covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: update propagate warning-only test to assert --gate-decision requirement.</item>
  <item>RFC-0866: update test — --gate-decision is now optional with conventional path fallback.</item>
  <item>RFC-1190: pass --mission — unresolved mission context now blocks before the gate-decision load under test.</item>
  <item>RFC-1190: restore mission context + evidence archival in release-mode deploys

RFC-1190: precedence-ordered resolveMissionContext (--mission → release build-identity → currentMission), MISSION_CONTEXT_UNRESOLVED/MISMATCH blocking, fail-closed EVIDENCE_SYNC_FAILED with --skip-evidence-sync as sole escape hatch, journaled evidence-sync-* ship steps after each certify-*, evidence.sync --site/--system flag.

2026-10-04 handoff fixes: shared 25min mission.check timeout (inner 5min race + 300s orchestrator raced cold ~7-11min captures), sweep excludeOpIds so mission.close no longer self-abandons the live ship journal (broke --resume), name-keyed journal resume state so closed-mission plan shifts can't skip unexecuted steps, wrangler dev documented as the required --base-url preview server.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { runLeitstandPropagate } from "../leitstand/leitstand-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

const context = {
  io: createDefaultIO().io,
  workspaceRoot: "/tmp",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

test("leitstand.propagate (warning-only) auto-resolves gate-decision from conventional path", async () => {
  // RFC-1190: explicit mission context — unresolved context now blocks before
  // the gate-decision load this test exercises.
  const input: KernelCommandInput = {
    flags: { release: "r000001", site: "test-sys", mission: "test-sys-m000001" },
    argv: [],
  };
  // --gate-decision is now optional; auto-resolved from
  // systems-cache/{system}/gate-decisions/{release}-alt.json
  // With no file at that path, the error will come from loading the decision.
  await expect(runLeitstandPropagate(input, context)).rejects.toThrow();
});
