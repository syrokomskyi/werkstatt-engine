/*
<MODULE_CONTRACT>
<purpose>observability.stack.validate — offline config lint for the SigNoz observability stack (RFC-0338).</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0338: initial implementation.</item>
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

const STACK_DIR = "services/observability-stack";

const REQUIRED_FILES = [
  "service.config.yaml",
  "casting.yaml",
  "caddy/Caddyfile",
  "collector/collector-patch.yaml",
  "compose.extra.yaml",
  ".env.example",
  "README.md",
  "package.json",
] as const;

const REQUIRED_RUNBOOK_SECTIONS = ["Provision", "Upgrade", "Restore", "Rotate token"] as const;

const REQUIRED_ENV_VARS = [
  "WARPGOGOL_OTLP_TOKEN",
  "SIGNOZ_SMTP_HOST",
  "SIGNOZ_SMTP_PORT",
  "SIGNOZ_SMTP_USER",
  "SIGNOZ_SMTP_PASSWORD",
  "SIGNOZ_SMTP_FROM",
  "RESTIC_REPOSITORY",
  "RESTIC_PASSWORD",
] as const;

export async function runObservabilityStackValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const diagnostics: Diagnostic[] = [];
  const root = context.workspaceRoot;

  // OBS-STACK-01: required files
  for (const file of REQUIRED_FILES) {
    const path = join(root, STACK_DIR, file);
    if (!(await context.io.exists(path))) {
      diagnostics.push({
        ruleId: "OBS-STACK-01",
        severity: "error",
        file: `${STACK_DIR}/${file}`,
        message: `Required file is missing: ${STACK_DIR}/${file}`,
        fixHint: `Create ${file} per the RFC-0338 workspace layout.`,
      });
    }
  }

  // OBS-STACK-02: casting.yaml
  const castingPath = join(root, STACK_DIR, "casting.yaml");
  if (await context.io.exists(castingPath)) {
    const casting = await context.io.readFile(castingPath);
    if (!casting.includes("flavor: compose")) {
      diagnostics.push({
        ruleId: "OBS-STACK-02",
        severity: "error",
        file: `${STACK_DIR}/casting.yaml`,
        message: "casting.yaml must specify flavor: compose.",
        fixHint: "Set spec.deployment.flavor: compose.",
      });
    }
    if (!casting.includes("mode: docker")) {
      diagnostics.push({
        ruleId: "OBS-STACK-02",
        severity: "error",
        file: `${STACK_DIR}/casting.yaml`,
        message: "casting.yaml must specify mode: docker.",
        fixHint: "Set spec.deployment.mode: docker.",
      });
    }
  }

  // OBS-STACK-03: Caddyfile bearer-token guard
  const caddyPath = join(root, STACK_DIR, "caddy", "Caddyfile");
  if (await context.io.exists(caddyPath)) {
    const caddy = await context.io.readFile(caddyPath);
    if (!caddy.includes("Bearer {$WARPGOGOL_OTLP_TOKEN}")) {
      diagnostics.push({
        ruleId: "OBS-STACK-03",
        severity: "error",
        file: `${STACK_DIR}/caddy/Caddyfile`,
        message: "Caddyfile must enforce bearer-token auth on the ingest host.",
        fixHint: 'Add: @unauthorized not header Authorization "Bearer {$WARPGOGOL_OTLP_TOKEN}"',
      });
    }
    if (caddy.includes("4317") || caddy.includes("4318 :")) {
      // Check if 4318 is exposed directly (not via reverse_proxy)
      const lines = caddy.split("\n");
      for (const line of lines) {
        if (line.includes("4318") && !line.includes("reverse_proxy")) {
          diagnostics.push({
            ruleId: "OBS-STACK-03",
            severity: "error",
            file: `${STACK_DIR}/caddy/Caddyfile`,
            message: "Caddyfile exposes otel-collector port directly.",
            fixHint: "Use reverse_proxy to otel-collector:4318, never expose the port directly.",
          });
        }
      }
    }
  }

  // OBS-STACK-04: collector-patch.yaml
  const collectorPath = join(root, STACK_DIR, "collector", "collector-patch.yaml");
  if (await context.io.exists(collectorPath)) {
    const collector = await context.io.readFile(collectorPath);
    if (!collector.includes("transform/warpgogol-enrich")) {
      diagnostics.push({
        ruleId: "OBS-STACK-04",
        severity: "error",
        file: `${STACK_DIR}/collector/collector-patch.yaml`,
        message: "collector-patch.yaml must define transform/warpgogol-enrich processor.",
        fixHint: "Add the transform/warpgogol-enrich processor per RFC-0337.",
      });
    }
    if (!collector.includes("transform/warpgogol-redact")) {
      diagnostics.push({
        ruleId: "OBS-STACK-04",
        severity: "error",
        file: `${STACK_DIR}/collector/collector-patch.yaml`,
        message: "collector-patch.yaml must define transform/warpgogol-redact processor.",
        fixHint: "Add the transform/warpgogol-redact processor per RFC-0337.",
      });
    }
  }

  // OBS-STACK-05: .env.example
  const envExamplePath = join(root, STACK_DIR, ".env.example");
  if (await context.io.exists(envExamplePath)) {
    const envExample = await context.io.readFile(envExamplePath);
    for (const varName of REQUIRED_ENV_VARS) {
      if (!envExample.includes(varName)) {
        diagnostics.push({
          ruleId: "OBS-STACK-05",
          severity: "error",
          file: `${STACK_DIR}/.env.example`,
          message: `.env.example is missing variable: ${varName}`,
          fixHint: `Add ${varName}= to .env.example.`,
        });
      }
    }
    // Check for non-empty values (secrets committed)
    const envLines = envExample.split("\n");
    for (const line of envLines) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match && match[2] && match[2].trim() !== "") {
        // Allow numeric defaults like 587
        if (!/^\d+$/.test(match[2].trim())) {
          diagnostics.push({
            ruleId: "OBS-STACK-05",
            severity: "error",
            file: `${STACK_DIR}/.env.example`,
            message: `.env.example contains a non-empty value for ${match[1]} — possible secret committed.`,
            fixHint: "Set all values to empty in .env.example; real secrets go in .env only.",
          });
        }
      }
    }
  }

  // OBS-STACK-06: README.md runbook sections
  const readmePath = join(root, STACK_DIR, "README.md");
  if (await context.io.exists(readmePath)) {
    const readme = await context.io.readFile(readmePath);
    for (const section of REQUIRED_RUNBOOK_SECTIONS) {
      if (!readme.includes(section)) {
        diagnostics.push({
          ruleId: "OBS-STACK-06",
          severity: "warning",
          file: `${STACK_DIR}/README.md`,
          message: `README.md is missing runbook section: ${section}`,
          fixHint: `Add a "${section}" section to the README.md runbook.`,
        });
      }
    }
  }

  return diagnosticsResult("observability.stack.validate", diagnostics);
}
