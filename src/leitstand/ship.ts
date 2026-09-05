/*
<MODULE_CONTRACT>
  <purpose>RFC-0962: leitstand.ship — resumable full-pipeline deployment composite command.</purpose>
  <non-goals>
    <item>Do not re-implement underlying command logic — delegate via executeKernelCommand.</item>
    <item>Do not bypass certification authority — certify/deploy steps call the existing commands.</item>
    <item>Do not add --skip-step flags; --until is the only scope control (DNA-73).</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0962: initial leitstand.ship composite command — buildShipPlan, runLeitstandShip, ShipContext/ShipResult types.</item>
  <item>RFC-0962 fo-fix: --until validation, releaseId restoration from journal on resume, step metadata + durationMs tracking via StepResult, removed duplicate ShipStepResult type.</item>
  <item>RFC-0986: skip lifecycle phases (validate/reconcile/close) when mission is already closed; add cache-clone git divergence pre-flight check; auto-sync after release-prepare and certify-* steps; --force-with-lease in cache-to-bare push.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
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
import { flagSite } from "./deploy-helpers.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
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
  workpieceDir: string;
  cacheCloneDir: string;
  releaseId: string | null;
  logger: KernelRuntimeContext["logger"];
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
  dev: 9,
  alt: 11,
  main: 13,
  archived: 15,
};

const STEP_NAMES = [
  "preflight",
  "mission-validate",
  "mission-reconcile",
  "mission-close",
  "release-prepare",
  "sync-after-prepare",
  "release-ready",
  "certify-dev",
  "sync-after-dev",
  "certify-alt",
  "sync-after-alt",
  "certify-main",
  "sync-after-main",
  "verify",
  "mission-archive",
] as const;

// ─── Phase runner (delegates to executeKernelCommand with flag validation) ───

async function runShipPhase(
  ctx: ShipContext,
  commandName: string,
  argv: string[],
): Promise<{ exitCode: number; data?: Record<string, unknown>; summary?: string }> {
  const registry = await getOrBuildWorkspaceRegistry(ctx.workspaceRoot);
  const command = registry?.getCommand(commandName);
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
        return { exitCode: 1, summary: msg };
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

function buildPreflightStep(): OperationStep<ShipContext> {
  return {
    name: "preflight",
    run: async (ctx: ShipContext) => {
      // 1. Playwright Chromium ensure (site plugin, dynamic import per DNA-64)
      try {
        const siteChecksModule = "@warpgogol/werkstatt-site/checks";
        const { ensureChromium } = await import(siteChecksModule);
        await ensureChromium(ctx.workspaceRoot, ctx.logger);
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
      const envPath = path.join(ctx.workpieceDir, ".env");
      if (!existsSync(envPath)) {
        throw new Error(`preflight: .env file not found in workpiece ${ctx.workpieceDir}`);
      }
      ctx.logger.info("  [ship] preflight: env vars presence check ok");

      // 5. Cache-clone git divergence check (RFC-0986)
      // Warns if cache clone HEAD and bare repo HEAD have diverged —
      // mirror sync will fail with non-fast-forward in this case.
      const cacheDir = ctx.cacheCloneDir;
      if (existsSync(path.join(cacheDir, ".git"))) {
        try {
          const cacheHead = execSync("git rev-parse HEAD", {
            cwd: cacheDir,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();
          const bareDir = path.resolve(ctx.workspaceRoot, "..", "systems-git", ctx.systemId);
          if (existsSync(bareDir)) {
            try {
              const bareHead = execSync("git rev-parse master", {
                cwd: bareDir,
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
              }).trim();
              if (cacheHead !== bareHead) {
                ctx.logger.info(
                  `  [ship] preflight: WARN cache clone and bare repo have diverged (cache=${cacheHead.slice(0, 8)}, bare=${bareHead.slice(0, 8)}) — mirror sync may fail with non-fast-forward`,
                );
              } else {
                ctx.logger.info("  [ship] preflight: cache-clone git divergence check ok");
              }
            } catch {
              ctx.logger.info(
                "  [ship] preflight: cache-clone git divergence check skipped (bare repo unreadable)",
              );
            }
          }
        } catch {
          ctx.logger.info(
            "  [ship] preflight: cache-clone git divergence check skipped (cache clone unreadable)",
          );
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
      const gitStatus = execSync("git status --porcelain", {
        cwd: ctx.workpieceDir,
        encoding: "utf-8",
      }).trim();

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
      return { gate, releaseId, ...(deployResult.data ?? {}) };
    },
  };
}

// ─── buildShipPlan ───────────────────────────────────────────────────────────

function buildSyncStep(stepName: string): OperationStep<ShipContext> {
  return {
    name: stepName,
    run: async (ctx: ShipContext) => {
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
    ]),
    // RFC-0986: Auto-sync after certify-dev — certification may create evidence
    // commits in the cache clone.
    buildSyncStep("sync-after-dev"),
    buildCertifyAndDeployStep("certify-alt", "alt", "leitstand.propagate", (ctx, releaseId) => [
      `--site=${ctx.systemId}`,
      `--release=${releaseId}`,
    ]),
    // RFC-0986: Auto-sync after certify-alt.
    buildSyncStep("sync-after-alt"),
    buildCertifyAndDeployStep("certify-main", "main", "leitstand.promote", (ctx, releaseId) => [
      `--site=${ctx.systemId}`,
      `--release=${releaseId}`,
    ]),
    // RFC-0986: Auto-sync after certify-main.
    buildSyncStep("sync-after-main"),
    buildSimpleStep("verify", "leitstand.verify", (ctx) => [`--site=${ctx.systemId}`]),
    {
      name: "mission-archive",
      run: async (ctx: ShipContext) => {
        // Best-effort: archive the mission after shipping. Non-fatal on failure.
        try {
          const result = await runShipPhase(ctx, "mission.archive", [
            `--mission=${ctx.missionId}`,
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
    const filtered = allSteps.filter((s) => !lifecycleSteps.has(s.name));
    return {
      op: "leitstand.ship",
      steps: filtered.slice(0, stepCount),
    };
  }

  return {
    op: "leitstand.ship",
    steps: allSteps.slice(0, stepCount),
  };
}

// ─── Command handler ─────────────────────────────────────────────────────────

function checkMissionClosed(workspaceRoot: string, missionId: string): boolean {
  const missionYamlPath = path.join(workspaceRoot, "missions", missionId, "mission.yaml");
  if (!existsSync(missionYamlPath)) return false;
  try {
    const raw = readFileSync(missionYamlPath, "utf-8");
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
      case 6:
        return "dev";
      case 8:
        return "alt";
      case 10:
        return "main";
      case 12:
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
    case 9:
      return "dev";
    case 11:
      return "alt";
    case 13:
      return "main";
    case 15:
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

  const workpieceDir = path.join(workspaceRoot, "missions", missionId, "workpiece");
  const cacheCloneDir = resolveCacheClonePath(workspaceRoot, systemId);
  const operationsDir = path.join(cacheCloneDir, "operations");
  const journalPath = path.join(operationsDir, `ship-${missionId}.jsonl`);

  // Lazily create operations directory
  await fs.mkdir(operationsDir, { recursive: true });

  // --force: delete stale ship journal to start fresh
  if (isForce && existsSync(journalPath)) {
    await fs.unlink(journalPath);
    logger.info(`  [ship] --force: deleted stale journal ${journalPath}`);
  }

  const ctx: ShipContext = {
    workspaceRoot,
    systemId,
    missionId,
    workpieceDir,
    cacheCloneDir,
    releaseId: null,
    logger,
  };

  // Detect mission state — if already closed, skip lifecycle phases
  const missionClosed = checkMissionClosed(workspaceRoot, missionId);
  if (missionClosed) {
    logger.info(
      `  [ship] mission ${missionId} is closed — skipping lifecycle phases (validate, reconcile, close)`,
    );
  }

  const plan = buildShipPlan({ until, missionClosed });
  const stepCount = plan.steps.length;
  const reachedPhase = phaseFromStepCount(stepCount, missionClosed);

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

  const opResult = await runOperation(journalPath, plan, ctx, {
    missionId,
    platformVersion: "",
    resumeOpId: isResume ? incomplete?.opId : undefined,
  });

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
