/*
<MODULE_CONTRACT>
  <purpose>leitstand.ship — resumable full-pipeline deployment composite command for the leitstand surface (RFC-0962).</purpose>
  <non-goals>
    <item>Do not re-implement underlying command logic — delegate via executeKernelCommand.</item>
    <item>Do not bypass certification authority — certify/deploy steps call the existing commands.</item>
    <item>Do not add --skip-step flags; --until is the only scope control (DNA-73).</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1190: restore mission context + evidence archival in release-mode deploys

RFC-1190: precedence-ordered resolveMissionContext (--mission → release build-identity → currentMission), MISSION_CONTEXT_UNRESOLVED/MISMATCH blocking, fail-closed EVIDENCE_SYNC_FAILED with --skip-evidence-sync as sole escape hatch, journaled evidence-sync-* ship steps after each certify-*, evidence.sync --site/--system flag.

2026-10-04 handoff fixes: shared 25min mission.check timeout (inner 5min race + 300s orchestrator raced cold ~7-11min captures), sweep excludeOpIds so mission.close no longer self-abandons the live ship journal (broke --resume), name-keyed journal resume state so closed-mission plan shifts can't skip unexecuted steps, wrangler dev documented as the required --base-url preview server.</item>
  <item>RFC-1207: candidate-preview certify — wrangler dev on releases/<id>/dist/server measures the candidate artifact</item>
  <item>RFC-1217: preflight unreconciled-workpiece gate — cache-side `git fetch <workpieceDir> <branch>` + `rev-list HEAD..FETCH_HEAD` blocks ship when the workpiece carries commits the cache clone has not merged (the exact range fetch-and-merge would pull). Open missions only (closed-mission plans skip reconcile, so there is no merge to predict); git-unreadable degrades to a warning; --allow-unreconciled is the manual-merge escape hatch.</item>
  <item>RFC-1219: --resume logs the interrupted failed step (status/failedStep from findIncompleteOperation); formatShipTransition renders op-interrupted as "[ship] interrupted at step — run with --resume" for live followers.</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <history>RFC-0962, RFC-0986, RFC-1097, RFC-1149, RFC-1168, RFC-1190, warpgogol-m000175</history>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand, KERNEL_UNIVERSAL_FLAGS } from "@warpgogol/werkstatt-engine/kernel";
import { getOrBuildWorkspaceRegistry } from "../kernel/runtime/registry-cache.ts";
import { runOperation, findIncompleteOperation } from "../journal/index.ts";
import type { OperationDefinition, OperationStep, StepResult } from "../journal/index.ts";
import { resolveCacheClonePath } from "../sternsystem/registry-io.ts";
import { resolveMissionDir } from "../kernel/mission-resolver.ts";
import { flagSite } from "./deploy-helpers.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

// ─── RFC-1168 progress formatting (pure, exported for tests) ────────────────

/** Preamble lines naming the journal path and the watch invocation. */
export function shipPreambleLines(
  journalPath: string,
  systemId: string,
  missionId: string,
): string[] {
  return [
    `[ship] journal: ${journalPath}`,
    `[ship] watch: werkstatt run leitstand.ship.status --site ${systemId} --mission ${missionId} --follow`,
  ];
}

/** One `[ship] step N/M: <name> — <event>` line per journal transition. */
export function formatShipTransition(
  record: {
    kind: string;
    step?: string;
    seq?: number;
    error?: string;
    reason?: string;
    failedStep?: string;
  },
  stepCount: number,
  durationMs?: number,
): string | null {
  if (record.seq === undefined) {
    if (record.kind === "op-done") return "[ship] done";
    if (record.kind === "op-abandoned") return `[ship] abandoned — ${record.reason}`;
    if (record.kind === "op-interrupted") {
      return `[ship] interrupted at step "${record.failedStep}" — run with --resume`;
    }
    return null;
  }
  const n = record.seq + 1;
  if (record.kind === "step-started") {
    return `[ship] step ${n}/${stepCount}: ${record.step} — running`;
  }
  if (record.kind === "step-done") {
    const dur = durationMs !== undefined ? ` (${Math.round(durationMs / 1000)}s)` : "";
    return `[ship] step ${n}/${stepCount}: ${record.step} — done${dur}`;
  }
  if (record.kind === "step-failed") {
    const dur = durationMs !== undefined ? ` (${Math.round(durationMs / 1000)}s)` : "";
    return `[ship] step ${n}/${stepCount}: ${record.step} — failed — ${record.error}${dur}`;
  }
  if (record.kind === "step-skipped") {
    return `[ship] step ${n}/${stepCount}: ${record.step} — skipped`;
  }
  return null;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ShipPhase = "validated" | "closed" | "dev" | "alt" | "main" | "archived";

const VALID_PHASES: readonly ShipPhase[] = [
  "validated",
  "closed",
  "dev",
  "alt",
  "main",
  "archived",
];

export interface ShipContext {
  workspaceRoot: string;
  systemId: string;
  missionId: string;
  /** Resolved mission directory — archive-aware (`missions/<id>` or `missions/archive/<state>/<id>`). */
  missionDir: string;
  workpieceDir: string;
  cacheCloneDir: string;
  releaseId: string | null;
  /** True when mission.yaml declares `state: closed` — lifecycle steps are skipped. */
  missionClosed: boolean;
  /** RFC-1217: --allow-unreconciled downgrades the unreconciled-workpiece gate to a warning. */
  allowUnreconciled: boolean;
  logger: KernelRuntimeContext["logger"];
  io: KernelRuntimeContext["io"];
}

export interface ShipResult {
  siteId: string;
  missionId: string;
  releaseId: string | null;
  reachedPhase: ShipPhase | "preflight";
  steps: StepResult[];
  completed: boolean;
  failedStep?: string;
}

// ─── Phase mapping ───────────────────────────────────────────────────────────

const PHASE_STEP_COUNT: Record<ShipPhase, number> = {
  validated: 2,
  closed: 4,
  dev: 10,
  alt: 13,
  main: 16,
  archived: 18,
};

// ─── Phase runner (delegates to executeKernelCommand with flag validation) ───

async function runShipPhase(
  ctx: ShipContext,
  commandName: string,
  argv: string[],
): Promise<{ exitCode: number; data?: Record<string, unknown>; summary?: string }> {
  const registry = await getOrBuildWorkspaceRegistry(ctx.workspaceRoot);
  const command = registry?.commands.get(commandName);
  if (command) {
    const validFlags = new Set([
      ...Object.keys(KERNEL_UNIVERSAL_FLAGS),
      ...Object.keys(command.flags ?? {}),
    ]);
    for (const entry of argv) {
      if (!entry.startsWith("--")) continue;
      const flagName = entry.slice(2).split("=")[0];
      if (flagName && !validFlags.has(flagName)) {
        const msg = `Unknown flag "--${flagName}" for command "${commandName}" (called from leitstand.ship). Valid flags: ${[...validFlags].sort().join(", ")}`;
        ctx.logger.info(`  [ship] ${msg}`);
        const failed: { exitCode: number; data?: Record<string, unknown>; summary?: string } = {
          exitCode: 1,
          summary: msg,
        };
        return failed;
      }
    }
  }

  ctx.logger.info(`  [ship] ${commandName} ${argv.join(" ")}`);
  const result = (await executeKernelCommand({
    workspaceRoot: ctx.workspaceRoot,
    commandName,
    argv,
    outputFormat: "pretty",
  })) as { exitCode?: number; data?: Record<string, unknown>; summary?: string };
  return {
    exitCode: result.exitCode ?? 0,
    data: result.data,
    summary: result.summary,
  };
}

// ─── Step implementations ────────────────────────────────────────────────────

/**
 * RFC-1217: count workpiece commits the cache clone has not merged — cache-side,
 * the exact range fetch-and-merge will pull. `ok: false` means git was
 * unreadable (caller warn-skips rather than blocking on "cannot determine").
 */
async function countUnreconciledWorkpieceCommits(
  ctx: ShipContext,
): Promise<{ ok: true; count: number; oneline: string } | { ok: false; reason: string }> {
  const io = ctx.io;
  const gitAt = (dir: string, args: string[]) => io.exec("git", args, { cwd: dir });
  const branchRes = await gitAt(ctx.workpieceDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRes.exitCode === 0 ? branchRes.stdout.trim() : "";
  if (!branch || branch === "HEAD") {
    return { ok: false, reason: "workpiece branch unreadable (detached HEAD or not a git repo)" };
  }
  const fetchRes = await gitAt(ctx.cacheCloneDir, ["fetch", ctx.workpieceDir, branch]);
  if (fetchRes.exitCode !== 0) {
    return { ok: false, reason: `git fetch from workpiece failed: ${fetchRes.stderr.trim()}` };
  }
  const countRes = await gitAt(ctx.cacheCloneDir, ["rev-list", "HEAD..FETCH_HEAD", "--count"]);
  if (countRes.exitCode !== 0 || countRes.stdout.trim() === "") {
    return { ok: false, reason: `rev-list failed: ${countRes.stderr.trim() || "empty output"}` };
  }
  const listRes = await gitAt(ctx.cacheCloneDir, ["rev-list", "HEAD..FETCH_HEAD", "--oneline"]);
  return {
    ok: true,
    count: parseInt(countRes.stdout.trim(), 10),
    oneline: listRes.exitCode === 0 ? listRes.stdout.trim() : "",
  };
}

function buildPreflightStep(): OperationStep<ShipContext> {
  return {
    name: "preflight",
    run: async (ctx: ShipContext) => {
      // 1. Playwright Chromium ensure (site plugin, dynamic import per DNA-64)
      try {
        const siteChecksModule = "@warpgogol/werkstatt-site/checks";
        const { ensureChromium } = await import(siteChecksModule);
        await ensureChromium(ctx.workspaceRoot, ctx.logger, ctx.io);
        ctx.logger.info("  [ship] preflight: Chromium ensure ok");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`preflight: Chromium ensure failed: ${msg}`);
      }

      // 2. leitstand.status channel-drift report (RFC-0948)
      const statusResult = await runShipPhase(ctx, "leitstand.status", [`--site=${ctx.systemId}`]);
      if (statusResult.exitCode !== 0) {
        throw new Error(`preflight: leitstand.status failed: ${statusResult.summary ?? ""}`);
      }
      ctx.logger.info("  [ship] preflight: channel-drift report ok");

      // 3. Vectorize index ensure (best-effort, non-fatal — same pattern as deploy-execution.ts)
      try {
        await runShipPhase(ctx, "agent.search.warm", [`--site=${ctx.systemId}`]);
        ctx.logger.info("  [ship] preflight: Vectorize index warm ok");
      } catch {
        ctx.logger.info(
          "  [ship] preflight: Vectorize index warm skipped (not configured or not available)",
        );
      }

      // 4. Env vars presence check
      // Closed missions persist .env to the cache clone at mission.close
      // (RFC-0822); open missions carry it in the workpiece. Accept either
      // location for closed missions, and name the checked paths in the
      // error — a bare "not found in workpiece" hid both the archived-path
      // and the close-persistence cases.
      const envLocations = ctx.missionClosed
        ? [ctx.cacheCloneDir, ctx.workpieceDir]
        : [ctx.workpieceDir];
      let envFound = false;
      for (const dir of envLocations) {
        if (await ctx.io.exists(path.join(dir, ".env"))) {
          envFound = true;
          break;
        }
      }
      if (!envFound) {
        const where = envLocations.map((d) => path.join(d, ".env")).join(" or ");
        const hint = ctx.missionClosed
          ? " (mission is closed — .env should have been persisted to the cache clone by mission.close)"
          : "";
        throw new Error(`preflight: .env file not found at ${where}${hint}`);
      }
      ctx.logger.info("  [ship] preflight: env vars presence check ok");

      // 5. Stripped-archive notice — mission.archive removes workpiece
      // node_modules unless the mission had no releaseId. release.prepare
      // still resolves the archived workpiece but fails on
      // WORKPIECE-IMPORTS-01; warn early with the recovery recipe.
      if (
        ctx.missionClosed &&
        !(await ctx.io.exists(path.join(ctx.workpieceDir, "node_modules")))
      ) {
        ctx.logger.info(
          `  [ship] preflight: WARN workpiece node_modules missing (archive cleanup) — if release.prepare fails on WORKPIECE-IMPORTS-01, move missions/archive/closed/${ctx.missionId} back to missions/${ctx.missionId} and run pnpm install --filter ${ctx.systemId}, then re-archive after release`,
        );
      }

      // 6. Cache-clone git divergence check (RFC-0986)
      // Warns if cache clone HEAD and bare repo HEAD have diverged —
      // mirror sync will fail with non-fast-forward in this case.
      const cacheDir = ctx.cacheCloneDir;
      if (await ctx.io.exists(path.join(cacheDir, ".git"))) {
        const cacheHeadResult = await ctx.io.exec("git", ["rev-parse", "HEAD"], { cwd: cacheDir });
        const cacheHead = cacheHeadResult.exitCode === 0 ? cacheHeadResult.stdout.trim() : "";
        const bareDir = path.resolve(ctx.workspaceRoot, "..", "systems-git", ctx.systemId);
        if (!cacheHead) {
          ctx.logger.info(
            "  [ship] preflight: cache-clone git divergence check skipped (cache clone unreadable)",
          );
        } else if (await ctx.io.exists(bareDir)) {
          const bareHeadResult = await ctx.io.exec("git", ["rev-parse", "master"], {
            cwd: bareDir,
          });
          if (bareHeadResult.exitCode !== 0) {
            ctx.logger.info(
              "  [ship] preflight: cache-clone git divergence check skipped (bare repo unreadable)",
            );
          } else if (cacheHead !== bareHeadResult.stdout.trim()) {
            ctx.logger.info(
              `  [ship] preflight: WARN cache clone and bare repo have diverged (cache=${cacheHead.slice(0, 8)}, bare=${bareHeadResult.stdout.trim().slice(0, 8)}) — mirror sync may fail with non-fast-forward`,
            );
          } else {
            ctx.logger.info("  [ship] preflight: cache-clone git divergence check ok");
          }
        }
      }

      // 7. Unreconciled-workpiece gate (RFC-1217) — open missions only: closed
      // missions never run mission-reconcile, so there is no merge to predict
      // and no remedy to prescribe. Git-unreadable degrades to a warning (same
      // posture as the divergence check above); a non-zero count blocks.
      if (ctx.missionClosed) {
        ctx.logger.info(
          "  [ship] preflight: unreconciled-commit gate skipped (mission closed — no reconcile in plan)",
        );
      } else {
        const unreconciled = await countUnreconciledWorkpieceCommits(ctx);
        if (!unreconciled.ok) {
          ctx.logger.info(
            `  [ship] preflight: WARN unreconciled-commit gate indeterminate (${unreconciled.reason}) — continuing`,
          );
        } else if (unreconciled.count > 0) {
          const listing = unreconciled.oneline
            ? `\n${unreconciled.oneline
                .split("\n")
                .map((l) => `  ${l}`)
                .join("\n")}`
            : "";
          const msg =
            `preflight: ${unreconciled.count} unreconciled workpiece commit(s) not present ` +
            `in the cache clone:${listing}\n` +
            `Run \`pnpm exec werkstatt run mission.reconcile --mission ${ctx.missionId}\` first, ` +
            `or pass --allow-unreconciled for a deliberate manual-merge workflow.`;
          if (ctx.allowUnreconciled) {
            ctx.logger.info(`  [ship] preflight: WARN ${msg}`);
          } else {
            throw new Error(msg);
          }
        } else {
          ctx.logger.info("  [ship] preflight: unreconciled-commit gate ok");
        }
      }
    },
  };
}

function buildMissionValidateStep(): OperationStep<ShipContext> {
  return {
    name: "mission-validate",
    run: async (ctx: ShipContext) => {
      const validateResult = await runShipPhase(ctx, "mission.validate", [
        `--mission=${ctx.missionId}`,
      ]);
      if (validateResult.exitCode !== 0) {
        throw new Error(`mission.validate failed: ${validateResult.summary ?? ""}`);
      }

      // Self-healing: check for uncommitted generated files after validate
      const statusResult = await ctx.io.exec("git", ["status", "--porcelain"], {
        cwd: ctx.workpieceDir,
      });
      const gitStatus = statusResult.exitCode === 0 ? statusResult.stdout.trim() : "";

      if (gitStatus !== "") {
        ctx.logger.info(
          "  [ship] self-healing: uncommitted generated files detected, auto-committing",
        );
        const commitResult = await runShipPhase(ctx, "mission.git.commit", [
          `--mission=${ctx.missionId}`,
          `--message=ship: auto-commit generated files after validate`,
        ]);
        if (commitResult.exitCode !== 0) {
          throw new Error(`self-healing auto-commit failed: ${commitResult.summary ?? ""}`);
        }
        // Re-validate after auto-commit
        const revalidateResult = await runShipPhase(ctx, "mission.validate", [
          `--mission=${ctx.missionId}`,
        ]);
        if (revalidateResult.exitCode !== 0) {
          throw new Error(
            `mission.validate (after auto-commit) failed: ${revalidateResult.summary ?? ""}`,
          );
        }
      }
    },
  };
}

function buildSimpleStep(
  stepName: string,
  commandName: string,
  argvBuilder: (ctx: ShipContext) => string[],
  postRun?: (ctx: ShipContext, data: Record<string, unknown> | undefined) => void,
): OperationStep<ShipContext> {
  return {
    name: stepName,
    run: async (ctx: ShipContext): Promise<Record<string, unknown> | void> => {
      const result = await runShipPhase(ctx, commandName, argvBuilder(ctx));
      if (result.exitCode !== 0) {
        throw new Error(`${commandName} failed: ${result.summary ?? ""}`);
      }
      if (postRun) {
        postRun(ctx, result.data);
      }
      return result.data;
    },
  };
}

function buildCertifyAndDeployStep(
  stepName: string,
  gate: string,
  deployCommand: string,
  deployArgvBuilder: (ctx: ShipContext, releaseId: string) => string[],
): OperationStep<ShipContext> {
  return {
    name: stepName,
    run: async (ctx: ShipContext): Promise<Record<string, unknown> | void> => {
      const releaseId = ctx.releaseId ?? "";
      if (!releaseId) {
        throw new Error(`${stepName}: no releaseId in context — release-prepare must run first`);
      }

      // Certify
      const certifyResult = await runShipPhase(ctx, "leitstand.certify", [
        `--site=${ctx.systemId}`,
        `--gate=${gate}`,
        `--release=${releaseId}`,
      ]);
      if (certifyResult.exitCode !== 0) {
        throw new Error(`leitstand.certify --gate=${gate} failed: ${certifyResult.summary ?? ""}`);
      }

      // Deploy
      const deployResult = await runShipPhase(
        ctx,
        deployCommand,
        deployArgvBuilder(ctx, releaseId),
      );
      if (deployResult.exitCode !== 0) {
        throw new Error(`${deployCommand} failed: ${deployResult.summary ?? ""}`);
      }
      // RFC-1207: journal the candidate-preview identity in step-done.meta so
      // --resume can attribute evidence to the measured artifact (AC-6).
      const certifyData = certifyResult.data as { preview?: Record<string, unknown> } | undefined;
      return {
        gate,
        releaseId,
        ...(certifyData?.preview ? { candidatePreview: certifyData.preview } : {}),
        ...(deployResult.data ?? {}),
      };
    },
  };
}

// ─── buildShipPlan ───────────────────────────────────────────────────────────

async function syncCacheCloneBestEffort(ctx: ShipContext, stepName: string): Promise<void> {
  // RFC-0986: Auto-sync cache clone to bare repo after deployment phases
  // that create commits. Non-fatal — sync failure is logged but does not
  // block the deployment pipeline.
  try {
    const result = await runShipPhase(ctx, "sternsystem.sync", [`--id=${ctx.systemId}`]);
    if (result.exitCode !== 0) {
      ctx.logger.info(
        `  [ship] ${stepName}: sternsystem.sync failed (non-fatal): ${result.summary ?? ""}`,
      );
    } else {
      ctx.logger.info(`  [ship] ${stepName}: sternsystem.sync ok`);
    }
  } catch (err) {
    ctx.logger.info(
      `  [ship] ${stepName}: sternsystem.sync skipped (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function buildSyncStep(stepName: string): OperationStep<ShipContext> {
  return {
    name: stepName,
    run: (ctx: ShipContext) => syncCacheCloneBestEffort(ctx, stepName),
  };
}

// RFC-1190: dedicated journaled evidence-sync steps after each certify-* —
// archival moves out of deploy-execution's invisible branch. Absent
// evidence/axiom or missing evidence-metadata.json is a clean no-op; a failed
// upload while evidence exists is blocking (EVIDENCE_SYNC_FAILED).
function buildEvidenceSyncStep(stepName: string): OperationStep<ShipContext> {
  return {
    name: stepName,
    run: async (ctx: ShipContext): Promise<Record<string, unknown>> => {
      const evidenceDir = path.join(ctx.missionDir, "evidence", "axiom");
      const metadataPath = path.join(evidenceDir, "evidence-metadata.json");
      if (!(await ctx.io.exists(evidenceDir)) || !(await ctx.io.exists(metadataPath))) {
        return {
          missionId: ctx.missionId,
          skipped: true,
          reason: "no axiom evidence directory or evidence-metadata.json",
        };
      }
      const result = await runShipPhase(ctx, "evidence.sync", [
        `--site=${ctx.systemId}`,
        `--mission=${ctx.missionId}`,
      ]);
      if (result.exitCode !== 0) {
        throw new Error(`EVIDENCE_SYNC_FAILED: ${result.summary ?? "evidence.sync failed"}`);
      }
      return { missionId: ctx.missionId, skipped: false, ...(result.data ?? {}) };
    },
  };
}

export function buildShipPlan(input: {
  until: ShipPhase;
  missionClosed?: boolean;
}): OperationDefinition<ShipContext> {
  const stepCount = PHASE_STEP_COUNT[input.until];
  const skipLifecycle = input.missionClosed === true;

  const allSteps: OperationStep<ShipContext>[] = [
    buildPreflightStep(),
    buildMissionValidateStep(),
    buildSimpleStep("mission-reconcile", "mission.reconcile", (ctx) => [
      `--mission=${ctx.missionId}`,
    ]),
    buildSimpleStep("mission-close", "mission.close", (ctx) => [`--mission=${ctx.missionId}`]),
    buildSimpleStep(
      "release-prepare",
      "release.prepare",
      (ctx) => [`--mission=${ctx.missionId}`],
      (ctx, data) => {
        const releaseId = (data as { releaseId?: string } | undefined)?.releaseId;
        if (releaseId) {
          ctx.releaseId = releaseId;
        }
      },
    ),
    // RFC-0986: Auto-sync after release-prepare — release.prepare creates commits
    // in the cache clone (release tag, system-state update). Sync to bare repo
    // immediately so subsequent steps don't encounter a diverged bare repo.
    buildSyncStep("sync-after-prepare"),
    buildSimpleStep("release-ready", "release.ready", (ctx) => [
      `--release=${ctx.releaseId ?? ""}`,
    ]),
    buildCertifyAndDeployStep("certify-dev", "dev", "leitstand.dev-deploy", (ctx, releaseId) => [
      `--site=${ctx.systemId}`,
      `--release=${releaseId}`,
      `--mission=${ctx.missionId}`,
    ]),
    // RFC-1190: axiom evidence archival is a journaled step, not an invisible
    // deploy-internal branch — runs after the certify+deploy pair produced it.
    buildEvidenceSyncStep("evidence-sync-dev"),
    // RFC-0986: Auto-sync after certify-dev — certification may create evidence
    // commits in the cache clone.
    buildSyncStep("sync-after-dev"),
    buildCertifyAndDeployStep("certify-alt", "alt", "leitstand.propagate", (ctx, releaseId) => [
      `--site=${ctx.systemId}`,
      `--release=${releaseId}`,
      `--mission=${ctx.missionId}`,
    ]),
    buildEvidenceSyncStep("evidence-sync-alt"),
    // RFC-0986: Auto-sync after certify-alt.
    buildSyncStep("sync-after-alt"),
    buildCertifyAndDeployStep("certify-main", "main", "leitstand.promote", (ctx, releaseId) => [
      `--site=${ctx.systemId}`,
      `--release=${releaseId}`,
      `--mission=${ctx.missionId}`,
    ]),
    buildEvidenceSyncStep("evidence-sync-main"),
    // RFC-0986: Auto-sync after certify-main.
    buildSyncStep("sync-after-main"),
    buildSimpleStep("verify", "leitstand.verify", (ctx) => [`--site=${ctx.systemId}`]),
    {
      name: "mission-archive",
      run: async (ctx: ShipContext) => {
        // Best-effort: archive the mission after shipping. Non-fatal on failure.
        try {
          const result = await runShipPhase(ctx, "mission.archive", [
            `--site=${ctx.systemId}`,
            `--status=closed`,
          ]);
          if (result.exitCode !== 0) {
            ctx.logger.info(
              `  [ship] mission-archive: skipped (mission.archive unavailable or failed: ${result.summary ?? ""})`,
            );
          }
        } catch {
          ctx.logger.info("  [ship] mission-archive: skipped (mission.archive not registered)");
        }
      },
    },
  ];

  // When mission is already closed, skip lifecycle phases (validate, reconcile, close)
  // and start from release-prepare. This allows resuming a deployment after a
  // failed release.prepare without manually running individual steps.
  if (skipLifecycle) {
    const lifecycleSteps = new Set(["mission-validate", "mission-reconcile", "mission-close"]);
    // PHASE_STEP_COUNT is indexed against the full step list — slice first,
    // then drop lifecycle steps. Filtering before slicing overshoots the
    // --until boundary by 3 (e.g. --until alt would include certify-main).
    return {
      op: "leitstand.ship",
      steps: allSteps.slice(0, stepCount).filter((s) => !lifecycleSteps.has(s.name)),
    };
  }

  return {
    op: "leitstand.ship",
    steps: allSteps.slice(0, stepCount),
  };
}

// ─── Command handler ─────────────────────────────────────────────────────────

async function checkMissionClosed(
  missionDir: string,
  io: KernelRuntimeContext["io"],
): Promise<boolean> {
  const missionYamlPath = path.join(missionDir, "mission.yaml");
  if (!(await io.exists(missionYamlPath))) return false;
  try {
    const raw = await io.readFile(missionYamlPath);
    const parsed = parseYaml(raw) as { state?: string };
    return parsed.state === "closed";
  } catch {
    return false;
  }
}

function phaseFromStepCount(stepCount: number, missionClosed = false): ShipPhase | "preflight" {
  if (missionClosed) {
    // When lifecycle phases are skipped (mission already closed), step counts shift by -3.
    switch (stepCount) {
      case 0:
        return "preflight";
      case 7:
        return "dev";
      case 10:
        return "alt";
      case 13:
        return "main";
      case 15:
        return "archived";
      default:
        return "preflight";
    }
  }
  switch (stepCount) {
    case 0:
      return "preflight";
    case 2:
      return "validated";
    case 4:
      return "closed";
    case 10:
      return "dev";
    case 13:
      return "alt";
    case 16:
      return "main";
    case 18:
      return "archived";
    default:
      return "preflight";
  }
}

export async function runLeitstandShip(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ShipResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[leitstand.ship] --site is required");
  const missionId = flagString(input, "mission");
  if (!missionId) throw new Error("[leitstand.ship] --mission is required");
  const untilFlag = flagString(input, "until") as ShipPhase | undefined;
  const until = untilFlag ?? "archived";
  if (!VALID_PHASES.includes(until)) {
    throw new Error(
      `[leitstand.ship] invalid --until value "${untilFlag}". Valid phases: ${VALID_PHASES.join(", ")}`,
    );
  }
  const isResume = input.flags["resume"] === true;
  const isForce = input.flags["force"] === true;

  // Archive-aware mission resolution — closed missions may already sit in
  // missions/archive/<state>/ (deferred-release flow: close at session end,
  // ship later). resolveMissionDir returns the primary path as a fallback,
  // so verify the directory exists before deriving workpiece paths.
  const missionDir = await resolveMissionDir(workspaceRoot, missionId, context.io);
  if (!(await context.io.exists(missionDir))) {
    throw new Error(
      `[leitstand.ship] mission ${missionId} not found — expected a directory in missions/${missionId} or missions/archive/{closed,aborted}/${missionId}`,
    );
  }
  const workpieceDir = path.join(missionDir, "workpiece");
  const cacheCloneDir = resolveCacheClonePath(workspaceRoot, systemId);
  const operationsDir = path.join(cacheCloneDir, "operations");
  const journalPath = path.join(operationsDir, `ship-${missionId}.jsonl`);

  // Lazily create operations directory
  await context.io.mkdir(operationsDir);

  // --force: delete stale ship journal to start fresh
  if (isForce && (await context.io.exists(journalPath))) {
    await context.io.rm(journalPath);
    logger.info(`  [ship] --force: deleted stale journal ${journalPath}`);
  }

  // Detect mission state — if already closed, skip lifecycle phases
  const missionClosed = await checkMissionClosed(missionDir, context.io);

  const ctx: ShipContext = {
    workspaceRoot,
    systemId,
    missionId,
    missionDir,
    workpieceDir,
    cacheCloneDir,
    releaseId: null,
    missionClosed,
    allowUnreconciled: input.flags["allow-unreconciled"] === true,
    logger,
    io: context.io,
  };
  if (missionClosed) {
    logger.info(
      `  [ship] mission ${missionId} is closed — skipping lifecycle phases (validate, reconcile, close)`,
    );
  }

  const plan = buildShipPlan({ until, missionClosed });
  const stepCount = plan.steps.length;
  const reachedPhase = phaseFromStepCount(stepCount, missionClosed);

  // RFC-1168: progress goes straight to stderr — context.logger buffers into
  // the end-of-run envelope, which is exactly the opacity being fixed.
  const emitProgress = (line: string): void => {
    try {
      process.stderr.write(`${line}\n`);
    } catch {
      // Closed stderr (detached harness) must not break the operation.
    }
  };
  const stepStartTimes = new Map<number, number>();
  for (const line of shipPreambleLines(journalPath, systemId, missionId)) {
    emitProgress(line);
  }

  // Check for incomplete operation
  const existingRecords = await (async () => {
    try {
      const { readJournal } = await import("../journal/jsonl.ts");
      return await readJournal(journalPath);
    } catch {
      return [];
    }
  })();
  const incomplete = findIncompleteOperation(existingRecords);

  // Restore releaseId from journal on resume
  if (incomplete) {
    for (const record of existingRecords) {
      if (
        record.kind === "step-done" &&
        record.step === "release-prepare" &&
        record.meta?.releaseId
      ) {
        ctx.releaseId = record.meta.releaseId as string;
        logger.info(`  [ship] restored releaseId ${ctx.releaseId} from journal`);
        break;
      }
    }
  }

  if (isResume && !incomplete) {
    return {
      data: {
        siteId: systemId,
        missionId,
        releaseId: ctx.releaseId,
        reachedPhase,
        steps: [],
        completed: true,
      },
      summary: "[leitstand.ship] nothing to resume — no incomplete ship operation",
      exitCode: 0,
    };
  }

  if (!isResume && incomplete && incomplete.op === "leitstand.ship") {
    // Same-kind incomplete operation — auto-resume
    logger.info(`  [ship] incomplete operation found (${incomplete.opId}), resuming`);
  }
  if (incomplete?.status === "interrupted" && incomplete.failedStep) {
    logger.info(`  [ship] resuming interrupted op at failed step "${incomplete.failedStep}"`);
  }

  const opResult = await runOperation(journalPath, plan, ctx, {
    missionId,
    platformVersion: "",
    resumeOpId: isResume ? incomplete?.opId : undefined,
    // RFC-1168: one line per journal record — the live progress stream.
    onTransition: (record) => {
      if (record.kind === "step-started") {
        stepStartTimes.set(record.seq, Date.now());
      }
      const seq = "seq" in record ? record.seq : undefined;
      const started = seq !== undefined ? stepStartTimes.get(seq) : undefined;
      const durationMs = started !== undefined ? Date.now() - started : undefined;
      const line = formatShipTransition(record, stepCount, durationMs);
      if (line !== null) emitProgress(line);
    },
  });

  // Journal tail records (post-sync step-done/op-done) are appended after the
  // last in-plan sync — sweep and propagate so the cache clone exits clean.
  await syncCacheCloneBestEffort(ctx, "sync-final");

  if (opResult.completed) {
    return {
      data: {
        siteId: systemId,
        missionId,
        releaseId: ctx.releaseId,
        reachedPhase,
        steps: opResult.stepResults,
        completed: true,
      },
      summary: `[leitstand.ship] ${missionId} shipped to ${reachedPhase}${ctx.releaseId ? ` (release ${ctx.releaseId})` : ""} — ${opResult.executed.length} steps executed, ${opResult.skipped.length} resumed`,
      exitCode: 0,
    };
  }

  return {
    data: {
      siteId: systemId,
      missionId,
      releaseId: ctx.releaseId,
      reachedPhase,
      steps: opResult.stepResults,
      completed: false,
      failedStep: opResult.failedStep,
    },
    summary: `[leitstand.ship] failed at step: ${opResult.failedStep ?? "unknown"} — ${opResult.failedStepError ?? ""}`,
    exitCode: 1,
    nextSteps: [
      {
        action: `Fix the failing step, then run: pnpm exec werkstatt run leitstand.ship --site ${systemId} --mission ${missionId} --resume`,
        kind: "required",
      },
    ],
  };
}
