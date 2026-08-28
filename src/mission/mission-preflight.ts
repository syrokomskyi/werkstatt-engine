/*
<MODULE_CONTRACT>
<purpose>
  RFC-0971: mission.preflight — runs ownership.sync.validate and
  generated.stale.validate against the cache clone (systems-cache/<id>/)
  before a mission is opened. Read-only per K-0004 (evaluation must not
  mutate its subject). Dispatches to existing check commands via
  executeRegisteredCommand with a custom KernelRuntimeContext where
  site.directory points to the cache clone path.
</purpose>
<non-goals>
  <item>Do not sync the cache clone — syncing is a mutating operation (sternsystem.sync); preflight is read-only per K-0004.</item>
  <item>Do not create a generates.coverage.validate command — RFC-0970 explicitly did not create one; ownership.sync.validate already performs the coverage check.</item>
  <item>Do not replace mission.validate — preflight is a subset check that runs before materialization.</item>
  <item>Do not run build pipelines — preflight is metadata-only.</item>
  <item>Do not check content validity — that is the domain of author pipeline checks.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0971: initial implementation.</item>
  <item>RFC-0972: removed handler-local isJson exit code workaround — CLI layer now handles --json exit code globally.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
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
import { executeRegisteredCommand } from "@warpgogol/werkstatt-engine/kernel";
import { resolveCacheClonePath } from "../sternsystem/registry-io.ts";

const PREFLIGHT_CHECKS = ["ownership.sync.validate", "generated.stale.validate"] as const;

export interface MissionPreflightInput {
  system: string;
}

export interface PreflightCheckResult {
  command: string;
  status: "pass" | "fail";
  violations: number;
}

export interface MissionPreflightData {
  command: "mission.preflight";
  system: string;
  status: "pass" | "fail";
  checks: PreflightCheckResult[];
  totalViolations: number;
}

function countViolations(report: KernelExecutionReport): number {
  const data = report.data as CheckResult | undefined;
  if (!data || !data.diagnostics) return 0;
  return data.diagnostics.filter((d) => d.severity === "error").length;
}

function buildNextSteps(checks: PreflightCheckResult[]): KernelNextStep[] {
  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length === 0) return [];
  return [
    {
      action: `Fix ownership map violations reported by: ${failed.map((c) => c.command).join(", ")}`,
      kind: "required",
    },
  ];
}

export async function runMissionPreflight(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionPreflightData>> {
  const systemId = input.flags.system as string | undefined;
  if (!systemId) {
    return {
      data: {
        command: "mission.preflight",
        system: "",
        status: "fail",
        checks: [],
        totalViolations: 0,
      },
      exitCode: 1,
      summary: "[mission.preflight] missing required --system flag",
      nextSteps: [{ action: "Provide --system <id> flag", kind: "required" }],
    };
  }

  const cacheClonePath = resolveCacheClonePath(context.workspaceRoot, systemId);
  if (!existsSync(cacheClonePath)) {
    return {
      data: {
        command: "mission.preflight",
        system: systemId,
        status: "fail",
        checks: [],
        totalViolations: 0,
      },
      exitCode: 1,
      summary: `[mission.preflight] Cache clone not found at ${cacheClonePath}. Run sternsystem.register first.`,
      nextSteps: [
        {
          action: `Run: pnpm exec werkstatt run sternsystem.register --id ${systemId}`,
          kind: "required",
        },
      ],
    };
  }

  const cacheCloneSite: DiscoveredSiteWorkspace = {
    name: systemId,
    directory: cacheClonePath,
    toolsDirectory: join(cacheClonePath, "tools"),
  };

  const cacheCloneContext: KernelRuntimeContext = {
    ...context,
    site: cacheCloneSite,
  };

  const checks: PreflightCheckResult[] = [];
  let totalViolations = 0;

  for (const checkName of PREFLIGHT_CHECKS) {
    const command = context.registry.getCommand(checkName);
    if (!command) {
      checks.push({ command: checkName, status: "fail", violations: 0 });
      totalViolations += 1;
      context.logger.warn(`[mission.preflight] Command ${checkName} is not registered`);
      continue;
    }

    const report = await executeRegisteredCommand(command, cacheCloneContext, []);
    const violations = countViolations(report);
    const status = violations > 0 ? "fail" : "pass";
    checks.push({ command: checkName, status, violations });
    totalViolations += violations;
  }

  const overallStatus = totalViolations > 0 ? "fail" : "pass";
  const exitCode = totalViolations > 0 ? 1 : 0;

  const data: MissionPreflightData = {
    command: "mission.preflight",
    system: systemId,
    status: overallStatus,
    checks,
    totalViolations,
  };

  const summary =
    overallStatus === "pass"
      ? `[mission.preflight] ${systemId}: all ${checks.length} checks passed`
      : `[mission.preflight] ${systemId}: ${totalViolations} violation(s) across ${checks.filter((c) => c.status === "fail").length} check(s)`;

  return {
    data,
    exitCode,
    summary,
    nextSteps: buildNextSteps(checks),
  };
}
