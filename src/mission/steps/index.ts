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
  <item>RFC-1219: resolveOperationSteps gains KernelRuntimeContext and returns { steps, ctx } — mission.resume previously passed a thin {workspaceRoot, missionId, manifest, context} runtime ctx, so every resumed step crashed on missing fields (m000192: fetch-and-merge died with "path argument must be of type string. Received undefined"). Each kind now reconstructs the command ctx: derivable fields resolved (dirs, systemDir, state), flag-derived fields defaulted (documented resume semantics: flags reset on resume).</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type { KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import type { OperationStep } from "../../journal/index.ts";
import type { MissionManifest } from "@warpgogol/werkstatt-engine/schemas";
import { resolveMissionDir } from "../mission-io.ts";
import { resolveCacheClonePath } from "../../sternsystem/registry-io.ts";

export interface ResolvedOperation {
  steps: OperationStep<unknown>[];
  /** Fully reconstructed per-kind step ctx — pass to runOperation as ctx. */
  ctx: unknown;
}

/**
 * Resolve the step list AND the runtime ctx for an operation kind.
 * The ctx mirrors what the command handler constructs — flag-derived values
 * default (resume semantics: flags are not journaled, so a resumed op
 * continues with defaults), accumulators start fresh, and `actor` is
 * "agent" (matching mission.resume's lock actor).
 */
export async function resolveOperationSteps(
  op: string,
  workspaceRoot: string,
  missionId: string,
  manifest: unknown,
  context: KernelRuntimeContext,
): Promise<ResolvedOperation | null> {
  const typedManifest = manifest as MissionManifest;
  const missionDir = await resolveMissionDir(workspaceRoot, missionId, context.io);
  const workpieceDir = path.join(missionDir, "workpiece");
  const evidenceDir = path.join(missionDir, "evidence");
  const now = new Date().toISOString();
  const logger = context.logger;

  switch (op) {
    case "mission.close": {
      const mod = await import("./close-steps.ts");
      const ctx: import("../mission-close.ts").CloseStepCtx = {
        workspaceRoot,
        missionId,
        missionDir,
        workpieceDir,
        evidenceDir,
        manifest: typedManifest,
        actor: "agent",
        releaseId: null,
        now,
        skipEvidenceSync: false,
        skipAutoSync: false,
        skipReconcileCheck: false,
        allowNoOp: false,
        skipContentRegression: false,
        skipBehaviorSnapshot: false,
        context,
        templateSyncResult: { synced: false, syncError: null },
        closeReport: null,
        evidenceSynced: false,
        evidenceSyncResult: null,
        freshnessChecked: false,
        unreconciledCommits: 0,
        workpieceHead: null,
        reconciledSha: null,
        originSha: null,
        mirrorSha: null,
        mirrorInSync: false,
        recommendation: null,
      };
      return { steps: await mod.buildCloseSteps(workspaceRoot, missionId, ctx), ctx };
    }
    case "mission.reconcile": {
      const mod = await import("./reconcile-steps.ts");
      const ctx: import("../mission-materialization-commands.ts").ReconcileStepCtx = {
        workspaceRoot,
        missionId,
        missionDir,
        workpieceDir,
        evidenceDir,
        systemDir: resolveCacheClonePath(workspaceRoot, typedManifest.systemId),
        manifest: typedManifest,
        actor: "agent",
        message: `Reconcile ${missionId}`,
        now,
        context,
        commitSha: null,
        preReconcileSha: null,
        mergeCommitSha: null,
        transferredCommits: 0,
        mergedShas: [],
        copiedPaths: [],
        autoResolvedPaths: [],
        workpieceHeadAtReconcile: null,
        gitignoreRestored: false,
        forbiddenFilesUntracked: [],
        mirrorSync: { attempted: false, succeeded: false, error: null },
        divergenceWarning: null,
        workpieceCommit: { committed: false, commitSha: null },
      };
      return { steps: await mod.buildReconcileSteps(workspaceRoot, missionId, ctx), ctx };
    }
    case "mission.materialize": {
      const mod = await import("./materialize-steps.ts");
      const { resolveStagingDir } = await import("../../werkstatt/atomic.ts");
      const operationId = typedManifest.operationId ?? "";
      const ctx: import("../mission-materialize.ts").MaterializeStepCtx = {
        workspaceRoot,
        missionId,
        manifest: typedManifest,
        context,
        logger,
        reportOnly: false,
        skipPreflight: false,
        force: false,
        systemDir: resolveCacheClonePath(workspaceRoot, typedManifest.systemId),
        missionDir,
        workpieceDir,
        stagingDir: resolveStagingDir(missionDir, workpieceDir, operationId),
        operationId,
        verdict: "in-sync",
        pinVersion: "",
        platformVersion: "",
        message: `Materialize ${missionId}`,
        preflightSkipped: false,
        preflightSkipReason: null,
        artifactCacheHit: false,
        artifactCacheKey: null,
        artifactCacheSkipped: false,
        cacheCloneHead: null,
        artifactCacheKeyComponents: null,
        regeneratedFiles: [],
        mediaCacheWarmed: false,
        mediaCacheSources: 0,
        bordbuchHookInstalled: false,
        clonedGitDir: null,
        prepareReport: { ok: true, steps: [] },
        workspaceGlobCheck: { stalePackages: [], ok: true },
        now,
      };
      return { steps: await mod.buildMaterializeSteps(workspaceRoot, missionId, ctx), ctx };
    }
    case "mission.open": {
      const mod = await import("./open-steps.ts");
      const { readSystemState } = await import("../../sternsystem/registry-io.ts");
      const ctx: import("../mission-open.ts").OpenStepCtx = {
        workspaceRoot,
        systemId: typedManifest.systemId,
        missionId,
        manifest: typedManifest,
        actor: "agent",
        now,
        pinAtOpen: "",
        operationId: typedManifest.operationId ?? "",
        staleEntries: { removedPaths: [], skipped: [] },
        context,
        state: await readSystemState(workspaceRoot, typedManifest.systemId, context.io),
        materializedAt: null,
      };
      return { steps: await mod.buildOpenSteps(workspaceRoot, missionId, ctx), ctx };
    }
    case "mission.validate": {
      const mod = await import("./validate-steps.ts");
      const ctx: import("../mission-materialization-commands.ts").ValidateStepCtx = {
        workspaceRoot,
        missionId,
        manifest: typedManifest,
        logger,
        evidenceDir,
        missionDir,
        workpieceDir,
        collectErrors: false,
        skipContentRegression: false,
        autoAcceptRegression: false,
        force: false,
        fast: false,
        previousReport: null,
        cascadeRerun: false,
        prepareReport: null,
        pipelineReport: null,
        staticPassed: false,
        stepCount: 0,
        failedSteps: [],
        buildSucceeded: false,
        buildError: undefined,
        routeCount: 0,
        sitemapHash: "",
        postPipelineReport: undefined,
        dirtyBeforeBuildPost: { dirty: false, fileCount: 0 },
        preliminaryBuildIdentityPath: null,
        now,
        io: context.io,
      };
      return { steps: mod.buildValidateSteps(ctx), ctx };
    }
    case "mission.archive": {
      const mod = await import("./archive-steps.ts");
      const steps = await mod.buildArchiveSteps(workspaceRoot, missionId, manifest);
      return { steps, ctx: { workspaceRoot, missionId, manifest, context } };
    }
    case "mission.abort": {
      const mod = await import("./abort-steps.ts");
      const ctx: import("../mission-abort.ts").AbortStepCtx = {
        workspaceRoot,
        missionId,
        missionDir,
        workpieceDir,
        evidenceDir,
        manifest: typedManifest,
        actor: "agent",
        reason: "resumed abort",
        now,
        io: context.io,
      };
      return { steps: await mod.buildAbortSteps(workspaceRoot, missionId, ctx), ctx };
    }
    default:
      return null;
  }
}
