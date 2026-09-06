/*
<MODULE_CONTRACT>
<purpose>Kernel module registration for @warpgogol/site-kernel-observability — hosts all observability.* and fleet.probe.* commands (RFC-0337).</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0337: initial implementation — registers observability.conventions.validate.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";
import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createObservabilityModule(): Promise<ModuleExport> {
const { runObservabilityConventionsValidate } =
      await import("./commands/conventions-validate.ts");
    const { runObservabilityStackValidate } = await import("./commands/stack-validate.ts");
    const { runObservabilityStackHealth } = await import("./commands/stack-health.ts");
    const { runObservabilityWorkersValidate } = await import("./commands/workers-validate.ts");
    const { runObservabilityFactorySmoke } = await import("./commands/factory-smoke.ts");
    const { runFleetProbeTargetsGenerate } = await import("./commands/probe-targets-generate.ts");
    const { runFleetProbeValidate } = await import("./commands/probe-validate.ts");
    const { runObservabilityAlertsGenerate } = await import("./commands/alerts-generate.ts");
    const { runObservabilityAlertsValidate } = await import("./commands/alerts-validate.ts");
    const { runObservabilityAlertsApply } = await import("./commands/alerts-apply.ts");
    const { runObservabilityDeliveryValidate } = await import("./commands/delivery-validate.ts");
    const { runObservabilityMcpValidate } = await import("./commands/mcp-validate.ts");
  return {
  name: "observability",
  version: "0.1.0",
    declarations: [],
  commands: [
    {
      name: "observability.conventions.validate",
      contract: "observability",
      rules: [],
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        "Offline lint: every metric name/label key is declared in WARPGOGOL_METRIC_REGISTRY, naming grammar is valid, no forbidden label keys, no duplicate names, no direct OTLP env reads outside @warpgogol/werkstatt-shared/observability (RFC-0337).",
      scope: "workspace",
      reads: [
        "packages/observability/src/metric-registry.ts",
        "packages/**/*.ts",
        "services/**/*.ts",
      ],
      flags: {},
      execute: runObservabilityConventionsValidate,
    },
    {
      name: "observability.stack.validate",
      contract: "observability",
      rules: [],
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        "Offline config lint for the SigNoz observability stack: required files, casting.yaml, Caddyfile auth, collector patch, .env.example, README runbook (RFC-0338).",
      scope: "workspace",
      reads: ["services/observability-stack/**"],
      flags: {},
      execute: runObservabilityStackValidate,
    },
    {
      name: "observability.stack.health",
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        "On-demand network round-trip check for the SigNoz stack: UI reachable, ingest rejects tokenless, smoke metric round-trip. Never in offline pipelines (RFC-0338).",
      scope: "workspace",
      requiresNetwork: true,
      timeoutMs: 15000,
      cacheable: false,
      flags: {},
      execute: runObservabilityStackHealth,
    },
    {
      name: "observability.workers.validate",
      contract: "observability",
      rules: [],
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        'Offline lint: every wrangler config with a main entry has observability.traces.enabled: true with destinations exactly ["signoz"] (RFC-0339).',
      scope: "workspace",
      reads: [
        "apps/*/wrangler.jsonc",
        "services/*/wrangler.jsonc",
        "packages/os/site-kernel-onboarding/src/templates/wrangler.template.jsonc",
      ],
      flags: {},
      execute: runObservabilityWorkersValidate,
    },
    {
      name: "observability.factory.smoke",
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        "Send a test metric (warpgogol_factory_smoke_total) through the OTLP pipe to verify end-to-end delivery. Network, manual-only — never in pipelines (RFC-0340).",
      scope: "workspace",
      requiresNetwork: true,
      timeoutMs: 10000,
      cacheable: false,
      flags: {},
      execute: runObservabilityFactorySmoke,
    },
    {
      name: "fleet.probe.targets.generate",
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        "Generate services/fleet-probe-runner/targets.generated.yaml from the workspace app origins and authored overrides (RFC-0341).",
      scope: "workspace",
      mutatesState: true,
      writes: ["services/fleet-probe-runner/targets.generated.yaml"],
      generates: [
        { path: "services/fleet-probe-runner/targets.generated.yaml", phase: "build.prepare" },
      ],
      reads: ["apps/*/astro.config.mjs", "services/fleet-probe-runner/targets.overrides.yaml"],
      cacheable: false,
      flags: {},
      execute: runFleetProbeTargetsGenerate,
    },
    {
      name: "fleet.probe.validate",
      contract: "fleet",
      rules: [],
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        "Offline lint: probe target list is fresh, schema-valid, fleet-only, and runner boundaries are clean (FLEET-PRB-01..05, RFC-0341).",
      scope: "workspace",
      reads: [
        "services/fleet-probe-runner/targets.generated.yaml",
        "services/fleet-probe-runner/targets.overrides.yaml",
        "services/fleet-probe-runner/src/**/*.ts",
        "apps/*/astro.config.mjs",
      ],
      flags: {},
      execute: runFleetProbeValidate,
    },
    {
      name: "observability.alerts.generate",
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        "Render authored alert rules and channels to docs/observability/alerts.generated.yaml (RFC-0342).",
      scope: "workspace",
      mutatesState: true,
      writes: ["docs/observability/alerts.generated.yaml"],
      generates: [{ path: "docs/observability/alerts.generated.yaml", phase: "build.prepare" }],
      reads: ["packages/os/site-kernel-observability/src/alert-rules.ts"],
      cacheable: false,
      flags: {},
      execute: runObservabilityAlertsGenerate,
    },
    {
      name: "observability.alerts.validate",
      contract: "observability",
      rules: [],
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        "Offline lint: alert projection is fresh, schema-valid, metrics declared, channels valid (OBS-ALR-01..05, RFC-0342).",
      scope: "workspace",
      reads: [
        "docs/observability/alerts.generated.yaml",
        "packages/os/site-kernel-observability/src/alert-rules.ts",
      ],
      flags: {},
      execute: runObservabilityAlertsValidate,
    },
    {
      name: "observability.alerts.apply",
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        "Converge SigNoz backend to the declared alert rules and channels. Network, ops-only — never in pipelines. Use --dry-run first (RFC-0342).",
      scope: "workspace",
      requiresNetwork: true,
      timeoutMs: 30000,
      cacheable: false,
      flags: {},
      execute: runObservabilityAlertsApply,
    },
    {
      name: "observability.delivery.validate",
      contract: "observability",
      rules: [],
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        "Offline lint: CF analytics poller zone map schema, siteId matching, boundary, and missing zone entries (OBS-DLV-01..04, RFC-0343).",
      scope: "workspace",
      reads: [
        "services/cf-analytics-poller/zones.jsonc",
        "services/cf-analytics-poller/src/**/*.ts",
      ],
      flags: {},
      execute: runObservabilityDeliveryValidate,
    },
    {
      name: "observability.mcp.validate",
      contract: "observability",
      rules: [],
      modulePath: "packages/werkstatt-engine/src/observability/module.ts",
      description:
        "Offline lint: .mcp.json signoz entry, no committed secrets, incidents template present (OBS-MCP-01..03, RFC-0344).",
      scope: "workspace",
      reads: [".mcp.json", "docs/observability/incidents/README.md"],
      flags: {},
      execute: runObservabilityMcpValidate,
    }
  ],
  pipelines: [

  ]};
}
;
