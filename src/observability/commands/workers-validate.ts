/*
<MODULE_CONTRACT>
<purpose>observability.workers.validate — offline lint ensuring every wrangler config exports traces to the signoz destination (RFC-0339).</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0339: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import type {
  CheckResult,
  Diagnostic,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { diagnosticsResult } from "@warpgogol/werkstatt-shared/checks";

interface WranglerConfig {
  main?: string;
  observability?: {
    enabled?: boolean;
    head_sampling_rate?: number;
    traces?: {
      enabled?: boolean;
      destinations?: string[];
      head_sampling_rate?: number;
    };
    logs?: {
      enabled?: boolean;
      head_sampling_rate?: number;
    };
  };
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseJsonc(text: string): WranglerConfig {
  const stripped = stripJsonComments(text);
  const cleaned = stripped.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(cleaned) as WranglerConfig;
}

const WRANGLER_GLOBS = [
  "apps/*/wrangler.jsonc",
  "services/*/wrangler.jsonc",
  "packages/os/site-kernel-onboarding/src/templates/wrangler.template.jsonc",
];

export async function runObservabilityWorkersValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const diagnostics: Diagnostic[] = [];
  const root = context.workspaceRoot;

  for (const glob of WRANGLER_GLOBS) {
    const files = await context.io.glob(glob, { cwd: root });
    for (const file of files) {
      const normalized = file.replace(/\\/g, "/");
      const text = await context.io.readFile(join(root, normalized));
      let config: WranglerConfig;
      try {
        config = parseJsonc(text);
      } catch {
        diagnostics.push({
          ruleId: "OBS-WRK-01",
          severity: "error",
          file: normalized,
          message: `Failed to parse wrangler config as JSONC.`,
          fixHint: "Fix the JSONC syntax error in this file.",
        });
        continue;
      }

      // Skip config-only fragments (no main entry = not a deployable Worker)
      if (!config.main) continue;

      const obs = config.observability;
      const isTemplate = normalized.includes("wrangler.template.jsonc");

      // OBS-WRK-01: traces.enabled must be true
      if (!obs?.traces?.enabled) {
        diagnostics.push({
          ruleId: "OBS-WRK-01",
          severity: "error",
          file: normalized,
          message: `Wrangler config with main entry lacks observability.traces.enabled: true.`,
          fixHint: isTemplate
            ? "Add the traces block to the onboarding template; regenerate site wrangler files."
            : 'Add "traces": { "enabled": true, "destinations": ["signoz"], "head_sampling_rate": 1.0 } to the observability block.',
        });
        continue;
      }

      // OBS-WRK-02: destinations must be exactly ["signoz"]
      const destinations = obs.traces.destinations;
      if (!destinations || destinations.length !== 1 || destinations[0] !== "signoz") {
        diagnostics.push({
          ruleId: "OBS-WRK-02",
          severity: "error",
          file: normalized,
          message: `observability.traces.destinations must be exactly ["signoz"], got: ${JSON.stringify(destinations)}`,
          fixHint: 'Set "destinations": ["signoz"] — no other destinations are allowed.',
        });
      }

      // OBS-WRK-03: sampling rate and logs.enabled warnings
      if (obs.traces.head_sampling_rate !== 1.0) {
        diagnostics.push({
          ruleId: "OBS-WRK-03",
          severity: "warning",
          file: normalized,
          message: `observability.traces.head_sampling_rate is ${obs.traces.head_sampling_rate}, expected 1.0.`,
          fixHint: "Set head_sampling_rate to 1.0 until fleet scale demands sampling.",
        });
      }
      if (!obs.logs?.enabled) {
        diagnostics.push({
          ruleId: "OBS-WRK-03",
          severity: "warning",
          file: normalized,
          message: `observability.logs.enabled is not true.`,
          fixHint: "Enable logs in the observability block.",
        });
      }
    }
  }

  return diagnosticsResult("observability.workers.validate", diagnostics);
}
