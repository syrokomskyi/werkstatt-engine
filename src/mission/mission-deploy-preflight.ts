/*
<MODULE_CONTRACT>
<purpose>
  RFC-1256: mission.deploy-preflight — deploy-readiness probe. Runs the
  historically fragile non-build validators (DEPLOY_PREFLIGHT_CHECKS) against
  a mission workpiece in one aggregated pass before mission.reconcile, so
  latent deploy blockers surface in a single report instead of across serial
  full-validation cycles. Read-only per K-0004; dispatches to registered check
  commands via executeRegisteredCommand with a KernelRuntimeContext whose
  site.directory points at the workpiece.
</purpose>
<non-goals>
  <item>Do not replace mission.validate — it remains the reconcile gate for full-lane missions; this probe stays advisory. RFC-1263 wires it into mission.content-edit as the fast lane's gate 4 (advisory there too) — never wired into leitstand.ship.</item>
  <item>Do not run build pipelines — every step is a non-build validator; the probe stays inside the RFC-0963 time budget.</item>
  <item>Do not mutate the workpiece — no commits, no artifact regeneration; workpieceDirty is informational only.</item>
  <item>Do not evaluate the cache clone — mission.preflight owns the cache-clone subject; this command only reads missions/{id}/workpiece.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>warpgogol-m000196: layout.rhythm.validate appended — post-hero density rhythm gate (mirrors DEPLOY_PREFLIGHT_STEPS in werkstatt-site).</item>
  <item>RFC-1256: initial implementation — mirrors mission-preflight.ts dispatch (RFC-1157 site-module resolution), aggregates all steps, warning-only steps report pass, workpieceDirty informational.</item>
  <item>RFC-1256: a11y.contrast.lint + mission.deploy-preflight — early deploy-blocker detection</item>
  <item>RFC-1256: review fixes — manifest-derived systemId, at-statement boundary, alpha/NaN guards, resolveSiteWorkspace, execOnReadOnly drift</item>
  <item>RFC-1263: deploy-preflight becomes the fast lane's advisory gate 4 (mission.content-edit).</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import type {
  CheckResult,
  KernelCommandInput,
  KernelCommandResult,
  KernelExecutionReport,
  KernelNextStep,
  KernelRuntimeContext,
  DiscoveredSiteWorkspace,
} from "@warpgogol/werkstatt-engine/kernel";
import { executeRegisteredCommand, siteModuleLoaders } from "@warpgogol/werkstatt-engine/kernel";
import { computeOwnershipMap } from "../kernel/runtime/execute-command.ts";
import { getOrBuildSiteModuleStates } from "../kernel/runtime/registry-cache.ts";
import { resolveMissionDir } from "../kernel/mission-resolver.ts";
import { isWorkpieceDirty } from "./mission-git-commit.ts";
import { readMissionManifest } from "./mission-io.ts";

/**
 * Deploy-blocker families observed in warpgogol-m000196 plus their fragile
 * neighbors. Mirrors DEPLOY_PREFLIGHT_STEPS in
 * packages/werkstatt-site/src/checks/pipelines/deploy-preflight.ts — the two
 * lists exist on opposite sides of the engine↛site package boundary; the
 * resolution test asserts every name here resolves to a registered command.
 */
export const DEPLOY_PREFLIGHT_CHECKS = [
  "semantic.parity",
  "feature.links.validate",
  "nachweis.validate",
  "generated.drift.validate",
  "a11y.contrast.lint",
  "ratgeber.claim.validate",
  "ratgeber.policy.validate",
  "typography.validate",
  "list.punctuation.validate",
  "shared.context.validate",
  "page.block.validate",
  "cosmic.catalog.validate",
  "layout.rhythm.validate",
] as const;

export interface DeployPreflightStepResult {
  command: string;
  status: "pass" | "fail" | "unavailable" | "skipped";
  violations: number;
  durationMs: number;
  /** Command's own summary — surfaced for skipped/vacuous steps so a skip reason is never dropped. */
  note?: string;
}

export interface MissionDeployPreflightData {
  command: "mission.deploy-preflight";
  mission: string;
  status: "pass" | "fail";
  steps: DeployPreflightStepResult[];
  totalViolations: number;
  totalDurationMs: number;
  workpieceDirty: boolean;
}

function countViolations(report: KernelExecutionReport): number {
  const data = report.data as CheckResult | undefined;
  if (!data || !data.diagnostics) return report.exitCode !== 0 ? 1 : 0;
  const errors = data.diagnostics.filter((d) => d.severity === "error").length;
  return errors > 0 ? errors : report.exitCode !== 0 ? 1 : 0;
}

function buildNextSteps(steps: DeployPreflightStepResult[]): KernelNextStep[] {
  const failed = steps.filter((s) => s.status === "fail" || s.status === "unavailable");
  if (failed.length === 0) return [];
  return [
    {
      action: `Fix deploy blockers reported by: ${failed.map((s) => s.command).join(", ")} — re-run an individual validator for detail, then mission.deploy-preflight`,
      kind: "required",
    },
  ];
}

export async function runMissionDeployPreflight(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionDeployPreflightData>> {
  const missionId = input.flags.mission as string | undefined;
  if (!missionId) {
    return {
      data: {
        command: "mission.deploy-preflight",
        mission: "",
        status: "fail",
        steps: [],
        totalViolations: 0,
        totalDurationMs: 0,
        workpieceDirty: false,
      },
      exitCode: 1,
      summary: "[mission.deploy-preflight] missing required --mission flag",
      nextSteps: [{ action: "Provide --mission <id> flag", kind: "required" }],
    };
  }

  const missionDir = await resolveMissionDir(context.workspaceRoot, missionId, context.io);
  const workpieceDir = missionDir ? join(missionDir, "workpiece") : undefined;
  if (!workpieceDir || !(await context.io.exists(workpieceDir))) {
    return {
      data: {
        command: "mission.deploy-preflight",
        mission: missionId,
        status: "fail",
        steps: [],
        totalViolations: 0,
        totalDurationMs: 0,
        workpieceDirty: false,
      },
      exitCode: 1,
      summary: `[mission.deploy-preflight] no workpiece at missions/${missionId}/workpiece — the probe has no subject. Open or materialize the mission first.`,
      nextSteps: [
        {
          action: `Run: pnpm exec werkstatt run mission.materialize --mission ${missionId}`,
          kind: "required",
        },
      ],
    };
  }

  // Identity-derived consumers (nachweis.validate resolves systemId from
  // site.name, generated.drift.validate uses it for generator dispatch) need
  // the Sternsystem id, not the mission id — read it from mission.yaml, same
  // as mission.validate's closed-workpiece site synthesis.
  let systemId = missionId;
  try {
    const manifest = await readMissionManifest(context.workspaceRoot, missionId, context.io);
    systemId = manifest.systemId;
  } catch (err) {
    context.logger.warn(
      `[mission.deploy-preflight] mission.yaml unreadable — site.name falls back to the mission id and identity-derived steps may skip: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const workpieceSite: DiscoveredSiteWorkspace = {
    name: systemId,
    directory: workpieceDir,
    toolsDirectory: join(workpieceDir, "tools"),
    configPath: join(workpieceDir, "tools", "kernel.config.ts"),
  };

  // RFC-1157: check commands live in site-module ActualStates — materialize
  // the canonical site module set once and merge its generator ownership into
  // the dispatch context (same pattern as mission.preflight).
  let siteStates: Awaited<ReturnType<typeof getOrBuildSiteModuleStates>> = new Map();
  try {
    siteStates = await getOrBuildSiteModuleStates(context.workspaceRoot, siteModuleLoaders());
  } catch (err) {
    context.logger.warn(
      `[mission.deploy-preflight] site-module states unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const ownershipMap = [...(context.ownershipMap ?? [])];
  const seenOwnership = new Set(ownershipMap.map((e) => `${e.command}:${e.artifact.path}`));
  for (const state of siteStates.values()) {
    const siteMap = await computeOwnershipMap(state);
    if (!siteMap) continue;
    for (const entry of siteMap) {
      const key = `${entry.command}:${entry.artifact.path}`;
      if (seenOwnership.has(key)) continue;
      seenOwnership.add(key);
      ownershipMap.push(entry);
    }
  }

  const workpieceContext: KernelRuntimeContext = {
    ...context,
    site: workpieceSite,
    ownershipMap,
  };

  const steps: DeployPreflightStepResult[] = [];
  let totalViolations = 0;
  let totalDurationMs = 0;

  for (const stepName of DEPLOY_PREFLIGHT_CHECKS) {
    const started = Date.now();
    let command = context.actualState.commands.get(stepName);
    if (!command) {
      for (const state of siteStates.values()) {
        command = state.commands.get(stepName);
        if (command) break;
      }
    }
    if (!command) {
      steps.push({ command: stepName, status: "unavailable", violations: 1, durationMs: 0 });
      totalViolations += 1;
      context.logger.warn(`[mission.deploy-preflight] Command ${stepName} is not registered`);
      continue;
    }

    const report = await executeRegisteredCommand(command, workpieceContext, []);
    const durationMs = Date.now() - started;
    totalDurationMs += durationMs;
    // Vacuity tripwire: a step that self-reports `skipped` (e.g. nachweis
    // entitlement unresolved) is surfaced distinctly — never masquerades as
    // "pass" and never drops its own reason (REVIEW-RFC-1256 finding).
    const skipped = (report.data as { skipped?: boolean } | undefined)?.skipped === true;
    const violations = countViolations(report);
    // Q-2 (AUDIT-RFC-1256-01): warning-only results count as pass — identical
    // to mission.validate semantics where advisory diagnostics do not block.
    const status = skipped ? "skipped" : violations > 0 ? "fail" : "pass";
    steps.push({
      command: stepName,
      status,
      violations,
      durationMs,
      ...(skipped && report.summary ? { note: report.summary } : {}),
    });
    totalViolations += violations;
  }

  const dirty = await isWorkpieceDirty(workpieceDir, context.io);

  const overallStatus = totalViolations > 0 ? "fail" : "pass";
  const data: MissionDeployPreflightData = {
    command: "mission.deploy-preflight",
    mission: missionId,
    status: overallStatus,
    steps,
    totalViolations,
    totalDurationMs,
    workpieceDirty: dirty.dirty,
  };

  const skippedCount = steps.filter((s) => s.status === "skipped").length;
  const skippedNote = skippedCount > 0 ? `, ${skippedCount} skipped` : "";
  const summary =
    overallStatus === "pass"
      ? `[mission.deploy-preflight] ${missionId}: ${steps.length - skippedCount}/${steps.length} deploy checks passed in ${(totalDurationMs / 1000).toFixed(1)}s${skippedNote}${dirty.dirty ? " (workpiece dirty — informational)" : ""}`
      : `[mission.deploy-preflight] ${missionId}: ${totalViolations} violation(s) across ${steps.filter((s) => s.status === "fail" || s.status === "unavailable").length} step(s)${skippedNote}`;

  return {
    data,
    exitCode: totalViolations > 0 ? 1 : 0,
    summary,
    nextSteps: buildNextSteps(steps),
  };
}
