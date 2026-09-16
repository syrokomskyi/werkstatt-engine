/*
<MODULE_CONTRACT>
  <purpose>steps index — barrel exports for mission lifecycle step definitions and resolver (RFC-0958).</purpose>
  <non-goals>
    <item>Do not implement step logic here — delegate to per-command step files.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial steps barrel with resolveOperationSteps resolver.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
