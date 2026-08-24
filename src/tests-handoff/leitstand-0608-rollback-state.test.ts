/*
<MODULE_CONTRACT>
  <purpose>RFC-0895/RFC-0926: leitstand.rollback accepts --to-release (RFC-0926) but still rejects --gate-decision. Native wrangler rollback targets the previous version automatically, or a specific Worker Version ID when --to-release is provided.</purpose>
  <keywords>RFC-0895, leitstand, rollback, to-release, gate-decision, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: update rollback test to assert --to-release requirement.</item>
  <item>RFC-0895: --to-release and --gate-decision are now rejected, not required. Update test to assert rejection.</item>
  <item>RFC-0926: --to-release is now accepted again (release-aware rollback). --gate-decision remains rejected.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { runLeitstandRollback } from "../leitstand/leitstand-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";

const context = {
  workspaceRoot: "/tmp",
  logger: { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
} as unknown as KernelRuntimeContext;

test("leitstand.rollback accepts --to-release (RFC-0926)", async () => {
  const input: KernelCommandInput = {
    flags: { site: "test-sys", "to-release": "r000001" },
    argv: [],
  };
  // --to-release is now accepted (RFC-0926). The command will proceed to resolve
  // the version ID from deployment-effect-records. Since no system config exists
  // at /tmp, it will throw with a config error — NOT the old rejection error.
  await expect(runLeitstandRollback(input, context)).rejects.toThrow(
    /has no deployment config|not found|ENOENT|resolveCacheClonePath/i,
  );
});

test("leitstand.rollback rejects --gate-decision (RFC-0895)", async () => {
  const input: KernelCommandInput = {
    flags: { site: "test-sys", "gate-decision": "/tmp/gate.json" },
    argv: [],
  };
  await expect(runLeitstandRollback(input, context)).rejects.toThrow(
    "--gate-decision is no longer supported",
  );
});

test("leitstand.rollback requires --site or --service", async () => {
  const input: KernelCommandInput = { flags: {}, argv: [] };
  await expect(runLeitstandRollback(input, context)).rejects.toThrow(
    "--site or --service is required",
  );
});
