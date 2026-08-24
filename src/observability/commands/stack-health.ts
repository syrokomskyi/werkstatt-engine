/*
<MODULE_CONTRACT>
<purpose>observability.stack.health — on-demand network round-trip check for the SigNoz stack (RFC-0338). Never in offline pipelines.</purpose>
<non-goals>
  <item>Never wired into build.check or packages-check (network command).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0338: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { createMetricsPusher, METRIC_REFS } from "@warpgogol/werkstatt-shared/observability";

const UI_URL = "https://observe.warpgogol.com";
const INGEST_URL = "https://ingest.observe.warpgogol.com";

export async function runObservabilityStackHealth(
  _input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<
  KernelCommandResult<{
    command: string;
    checks: Array<{ name: string; ok: boolean; detail?: string }>;
  }>
> {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  // Check 1: UI reachable
  try {
    const uiResponse = await fetch(UI_URL, { redirect: "manual" });
    const ok = uiResponse.status === 200 || uiResponse.status === 302;
    checks.push({
      name: "ui-reachable",
      ok,
      detail: `HTTP ${uiResponse.status}`,
    });
  } catch (error) {
    checks.push({
      name: "ui-reachable",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // Check 2: Ingest rejects tokenless requests
  try {
    const ingestResponse = await fetch(`${INGEST_URL}/v1/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceMetrics: [] }),
    });
    const ok = ingestResponse.status === 401;
    checks.push({
      name: "ingest-rejects-tokenless",
      ok,
      detail: `HTTP ${ingestResponse.status}`,
    });
  } catch (error) {
    checks.push({
      name: "ingest-rejects-tokenless",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // Check 3: Smoke metric round-trip (only if env vars are set)
  const pusher = createMetricsPusher({
    serviceName: "site-kernel",
    layer: "factory",
    environment: "production",
  });
  if (pusher) {
    METRIC_REFS.warpgogol_factory_smoke_total.add(pusher, 1);
    const result = await pusher.flush();
    checks.push({
      name: "smoke-metric-roundtrip",
      ok: result.delivered,
      detail: result.delivered ? "delivered" : result.reason,
    });
  } else {
    checks.push({
      name: "smoke-metric-roundtrip",
      ok: false,
      detail: "WARPGOGOL_OTLP_ENDPOINT/WARPGOGOL_OTLP_TOKEN not set — skipping smoke test",
    });
  }

  const allOk = checks.every((c) => c.ok);
  return {
    data: {
      command: "observability.stack.health",
      checks,
    },
    exitCode: allOk ? 0 : 1,
    summary: `observability.stack.health: ${checks.filter((c) => c.ok).length}/${checks.length} checks passed`,
  };
}
