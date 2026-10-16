/**
 * <MODULE_CONTRACT>
 *   <purpose>RFC-1296: pure builders for validation-report.json — per-validator
 *            evidence summaries and the reuse-path contractFull block. Keeps
 *            the evidence-shaping logic testable without running a build.</purpose>
 *   <role>Mission / engine</role>
 *   <consumers>mission-materialization-commands.ts, validation-report-evidence.test.ts</consumers>
 *   <change_rules>
 *     <item>contractFull.passed may never be true without listed validators
 *           (DNA-106 — evidence fields derive from verified outcomes).</item>
 *   </change_rules>
 * </MODULE_CONTRACT>
 */

import type {
  KernelExecutionReport,
  KernelPipelineReport,
} from "@warpgogol/werkstatt-engine/kernel";
import { summarizeStepDiagnostics } from "@warpgogol/werkstatt-shared/kernel";

import type {
  PreviousValidationReport,
  ValidationReportValidator,
} from "./mission-materialization-commands.ts";

/**
 * Map build.check + build.post pipeline steps to validator entries carrying
 * per-rule error/warning counts.
 */
export function validatorsFromPipelineReports(
  checkReport: KernelPipelineReport | null | undefined,
  postReport: KernelPipelineReport | null | undefined,
): ValidationReportValidator[] {
  const map =
    (pipeline: "build.check" | "build.post") =>
    (s: KernelExecutionReport): ValidationReportValidator => ({
      name: s.commandName,
      pipeline,
      status: s.ok ? "pass" : "fail",
      exitCode: s.exitCode,
      ...summarizeStepDiagnostics(s.data, s.exitCode),
    });
  return [
    ...(checkReport?.steps.map(map("build.check")) ?? []),
    ...(postReport?.steps.map(map("build.post")) ?? []),
  ];
}

/**
 * The reuse-path contractFull: copies the previous report's validator evidence
 * and stamps `reusedFrom`. Reuse without evidence is not a pass — the operator
 * reruns a full `mission.validate`.
 */
export function contractFullFromPrevious(previous: PreviousValidationReport | null): {
  passed: boolean;
  validators: ValidationReportValidator[];
  reusedFrom?: string;
  reason?: string;
} {
  const validators = previous?.contractFull.validators ?? [];
  if (!previous || validators.length === 0) {
    return { passed: false, validators, reason: "no-validator-evidence" };
  }
  // The evidence is listed; pass only when every reused validator passed.
  return {
    passed: validators.every((v) => v.status === "pass"),
    validators,
    reusedFrom: previous.validatedAt,
  };
}
