/*
<MODULE_CONTRACT>
<purpose>observability.conventions.validate command handler — offline lint that keeps every emitter inside the closed vocabulary (RFC-0337).</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0337: initial implementation.</item>
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
import {
  FORBIDDEN_LABEL_KEYS,
  METRIC_NAME_PATTERN,
  WARPGOGOL_METRIC_REGISTRY,
} from "@warpgogol/werkstatt-shared/observability";

const METRIC_NAME_LITERAL_PATTERN =
  /["']((?:warpgogol_(?:factory|probe|delivery|workers)_[a-z0-9_]+))["']/g;
const PUSHER_CALL_PATTERN = /(?:counterAdd|gaugeSet|histogramRecord)\s*\(/;
const METRIC_REFS_ACCESS_PATTERN =
  /METRIC_REFS\.((?:warpgogol_(?:factory|probe|delivery|workers)_[a-z0-9_]+))/g;
const OTLP_ENV_PATTERN = /(?:WARPGOGOL_OTLP_ENDPOINT|WARPGOGOL_OTLP_TOKEN)/;

export async function runObservabilityConventionsValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const diagnostics: Diagnostic[] = [];

  // OBS-CONV-02: registry entry naming grammar
  for (const spec of WARPGOGOL_METRIC_REGISTRY) {
    if (!METRIC_NAME_PATTERN.test(spec.name)) {
      diagnostics.push({
        ruleId: "OBS-CONV-02",
        severity: "error",
        file: "packages/observability/src/metric-registry.ts",
        message: `Metric name "${spec.name}" does not match the naming grammar ${METRIC_NAME_PATTERN.source}.`,
        fixHint:
          "Metric names must match ^warpgogol_(factory|probe|delivery|workers)_[a-z0-9_]+$, counters end in _total, durations in _seconds, sizes in _bytes.",
      });
    }
  }

  // OBS-CONV-03: forbidden label keys in registry
  for (const spec of WARPGOGOL_METRIC_REGISTRY) {
    for (const key of spec.labelKeys) {
      if (FORBIDDEN_LABEL_KEYS.includes(key)) {
        diagnostics.push({
          ruleId: "OBS-CONV-03",
          severity: "error",
          file: "packages/observability/src/metric-registry.ts",
          message: `Metric "${spec.name}" declares forbidden label key "${key}".`,
          fixHint: `Forbidden label keys: ${FORBIDDEN_LABEL_KEYS.join(", ")}. Remove the label or use a bounded alternative.`,
        });
      }
    }
  }

  // OBS-CONV-05: duplicate metric names
  const seen = new Map<string, number>();
  for (const spec of WARPGOGOL_METRIC_REGISTRY) {
    seen.set(spec.name, (seen.get(spec.name) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) {
      diagnostics.push({
        ruleId: "OBS-CONV-05",
        severity: "error",
        file: "packages/observability/src/metric-registry.ts",
        message: `Duplicate metric name "${name}" appears ${count} times in WARPGOGOL_METRIC_REGISTRY.`,
        fixHint: "Each metric name must be unique in the registry.",
      });
    }
  }

  // Build the set of declared metric names for OBS-CONV-01
  const declaredNames = new Set(WARPGOGOL_METRIC_REGISTRY.map((s) => s.name));

  // OBS-CONV-01: scan for undeclared metric name literals used with pusher calls or METRIC_REFS
  const sourceGlobs = ["packages/**/*.ts", "services/**/*.ts"];
  for (const glob of sourceGlobs) {
    const files = await context.io.glob(glob, { cwd: context.workspaceRoot });
    for (const file of files) {
      const normalized = file.replace(/\\/g, "/");
      // Skip the observability package itself (it declares the registry + typed refs)
      if (normalized.startsWith("packages/observability/")) continue;
      const text = await context.io.readFile(join(context.workspaceRoot, normalized));
      const usedNames = new Set<string>();
      let match: RegExpExecArray | null;
      // String-literal pusher calls
      if (PUSHER_CALL_PATTERN.test(text)) {
        METRIC_NAME_LITERAL_PATTERN.lastIndex = 0;
        while ((match = METRIC_NAME_LITERAL_PATTERN.exec(text)) !== null) {
          usedNames.add(match[1]!);
        }
      }
      // METRIC_REFS property accesses (typed-ref consumers)
      METRIC_REFS_ACCESS_PATTERN.lastIndex = 0;
      while ((match = METRIC_REFS_ACCESS_PATTERN.exec(text)) !== null) {
        usedNames.add(match[1]!);
      }
      for (const name of usedNames) {
        if (!declaredNames.has(name)) {
          diagnostics.push({
            ruleId: "OBS-CONV-01",
            severity: "error",
            file: normalized,
            message: `Metric name "${name}" is used with a pusher call or METRIC_REFS but is not declared in WARPGOGOL_METRIC_REGISTRY.`,
            fixHint: `Add "${name}" to packages/observability/src/metric-registry.ts or use an existing declared metric.`,
          });
        }
      }
    }
  }

  // OBS-CONV-04: direct OTLP env reads outside @warpgogol/werkstatt-shared/observability
  const envSourceGlobs = ["packages/**/*.ts", "services/**/*.ts"];
  for (const glob of envSourceGlobs) {
    const files = await context.io.glob(glob, { cwd: context.workspaceRoot });
    for (const file of files) {
      const normalized = file.replace(/\\/g, "/");
      // Skip the observability package and its kernel module — they are the port
      if (normalized.startsWith("packages/observability/")) continue;
      if (normalized.startsWith("packages/os/site-kernel-observability/")) continue;
      // Skip generated files
      if (normalized.includes(".generated.")) continue;
      const text = await context.io.readFile(join(context.workspaceRoot, normalized));
      if (OTLP_ENV_PATTERN.test(text)) {
        diagnostics.push({
          ruleId: "OBS-CONV-04",
          severity: "warning",
          file: normalized,
          message:
            "Direct reference to WARPGOGOL_OTLP_ENDPOINT/WARPGOGOL_OTLP_TOKEN outside @warpgogol/werkstatt-shared/observability. Emitters must go through the port.",
          fixHint:
            "Use createMetricsPusher from @warpgogol/werkstatt-shared/observability which reads env vars internally.",
        });
      }
    }
  }

  return diagnosticsResult("observability.conventions.validate", diagnostics);
}
