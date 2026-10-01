/*
<MODULE_CONTRACT>
<purpose>Null deployment adapter — no-op DeploymentAdapter used for `adapter: "null"` registry entries (systems with no deployable runtime). Reports success for propagate/rollback, unknown health, and no capabilities.</purpose>
<non-goals>
  <item>Do not add real deployment behavior — this adapter is the explicit no-runtime sentinel.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>REVIEW-CODE-2026-10-01-01: extracted from leitstand-commands.ts so the adapter registry can resolve names without importing the command module; carries bootSmokeCapable() → false (no runtime).</item>
</CHANGE_SUMMARY>
*/

import type { PropagationResult } from "@warpgogol/werkstatt-engine/schemas";
import type {
  DeploymentAdapter,
  PropagateInput,
  RollbackInput,
  RollbackResult,
  HealthInput,
} from "../adapter.ts";

export const nullAdapter: DeploymentAdapter = {
  name: "null",
  async propagate(input: PropagateInput): Promise<PropagationResult> {
    const now = new Date().toISOString();
    return {
      systemId: input.systemId,
      releaseId: input.releaseId,
      state: "succeeded",
      deploymentUrl: input.url,
      startedAt: now,
      completedAt: now,
      healthChecks: [],
    };
  },
  async rollback(input: RollbackInput): Promise<RollbackResult> {
    const now = new Date().toISOString();
    return {
      systemId: input.systemId,
      channel: input.channel,
      state: "succeeded",
      workerName: input.workerName,
      startedAt: now,
      completedAt: now,
      stdout: "",
      stderr: "",
    };
  },
  async health(_input: HealthInput) {
    return { state: "unknown" as const, checks: [] };
  },
  getLimits() {
    return { maxTotalSize: Infinity, maxFileSize: Infinity };
  },
  purgeCapable() {
    return false;
  },
  bootSmokeCapable() {
    return false;
  },
};
