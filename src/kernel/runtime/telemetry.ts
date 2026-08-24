/*
<MODULE_CONTRACT>
<purpose>Factory telemetry hook for kernel command execution (RFC-0340). Env-gated, fire-and-forget, never throws.</purpose>
<non-goals>
  <item>Never throw — telemetry failures must not affect command results.</item>
  <item>No network when env vars are absent — pusher is null.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0340: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import type { KernelExecutionReport } from "../types.ts";
import type { MetricsPusher } from "@warpgogol/werkstatt-shared/observability";
import { createMetricsPusher, METRIC_REFS } from "@warpgogol/werkstatt-shared/observability";

let pusher: MetricsPusher | null | undefined;

function getOrCreatePusher(): MetricsPusher | null {
  if (pusher !== undefined) return pusher;
  pusher = createMetricsPusher({
    serviceName: "werkstatt",
    layer: "factory",
    environment: undefined, // auto-detect from env (CI → ci, else development)
  });
  return pusher;
}

export function getFactoryTelemetryPusher(): MetricsPusher | null {
  return getOrCreatePusher();
}

function deriveStatus(report: KernelExecutionReport): string {
  if (report.timing?.exceededTimeout) return "timeout";
  if (report.exitCode === 0) return "pass";
  return report.exitCode === 1 ? "fail" : "error";
}

function countDiagnostics(
  report: KernelExecutionReport,
): Array<{ severity: string; count: number }> {
  const data = report.data as Record<string, unknown> | undefined;
  if (!data) return [];
  const diagnostics = data["diagnostics"] as Array<{ severity: string }> | undefined;
  if (!Array.isArray(diagnostics)) return [];
  const counts = new Map<string, number>();
  for (const d of diagnostics) {
    const sev = d.severity ?? "info";
    counts.set(sev, (counts.get(sev) ?? 0) + 1);
  }
  return [...counts.entries()].map(([severity, count]) => ({ severity, count }));
}

export function recordCommandTelemetry(pusher: MetricsPusher, report: KernelExecutionReport): void {
  try {
    const command = report.commandName;
    const status = deriveStatus(report);
    const siteId = report.siteName ?? "";
    const labels: Record<string, string> = { command, status };
    if (siteId) labels["site_id"] = siteId;

    // warpgogol_factory_command_runs_total{command, status, site_id}
    METRIC_REFS.warpgogol_factory_command_runs_total.add(pusher, 1, labels);

    // warpgogol_factory_command_duration_seconds{command, site_id}
    const durationSeconds = (report.timing?.durationMs ?? 0) / 1000;
    const histLabels: Record<string, string> = { command };
    if (siteId) histLabels["site_id"] = siteId;
    METRIC_REFS.warpgogol_factory_command_duration_seconds.record(
      pusher,
      durationSeconds,
      histLabels,
    );

    // warpgogol_factory_diagnostics_total{command, severity, site_id}
    for (const { severity, count } of countDiagnostics(report)) {
      const diagLabels: Record<string, string> = { command, severity };
      if (siteId) diagLabels["site_id"] = siteId;
      METRIC_REFS.warpgogol_factory_diagnostics_total.add(pusher, count, diagLabels);
    }
  } catch {
    // Never let telemetry affect command results
  }
}

export async function flushFactoryTelemetry(): Promise<void> {
  const p = getOrCreatePusher();
  if (p) {
    try {
      await p.flush();
    } catch {
      // Swallow all errors
    }
  }
}
