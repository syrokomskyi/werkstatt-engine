/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: barrel exports for mission lifecycle step definitions and resolver.</purpose>
  <non-goals>
    <item>Do not implement step logic here — delegate to per-command step files.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial steps barrel with resolveOperationSteps resolver.</item>
</CHANGE_SUMMARY>
*/

import type { OperationStep } from "../../journal/index.ts";

export async function resolveOperationSteps(
  op: string,
  workspaceRoot: string,
  missionId: string,
  manifest: unknown,
): Promise<OperationStep<unknown>[] | null> {
  switch (op) {
    case "mission.close": {
      const mod = await import("./close-steps.ts");
      return mod.buildCloseSteps(workspaceRoot, missionId, manifest);
    }
    case "mission.reconcile": {
      const mod = await import("./reconcile-steps.ts");
      return mod.buildReconcileSteps(workspaceRoot, missionId, manifest);
    }
    case "mission.materialize": {
      const mod = await import("./materialize-steps.ts");
      return mod.buildMaterializeSteps(workspaceRoot, missionId, manifest);
    }
    case "mission.open": {
      const mod = await import("./open-steps.ts");
      return mod.buildOpenSteps(workspaceRoot, missionId, manifest);
    }
    case "mission.validate": {
      const mod = await import("./validate-steps.ts");
      const ctx = {
        workspaceRoot,
        missionId,
        manifest,
      } as unknown as import("../mission-materialization-commands.ts").ValidateStepCtx;
      return mod.buildValidateSteps(ctx) as unknown as OperationStep<unknown>[];
    }
    case "mission.archive": {
      const mod = await import("./archive-steps.ts");
      return mod.buildArchiveSteps(workspaceRoot, missionId, manifest);
    }
    case "mission.abort": {
      const mod = await import("./abort-steps.ts");
      return mod.buildAbortSteps(workspaceRoot, missionId, manifest);
    }
    default:
      return null;
  }
}
