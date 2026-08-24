/*
<MODULE_CONTRACT>
<purpose>fleet.probe.validate — offline lint for the fleet probe target list and runner boundaries (RFC-0341).</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0341: initial implementation.</item>
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
import { parse as yamlParse } from "yaml";
import { readAstroSiteUrl } from "@warpgogol/werkstatt-shared/checks/lib/astro-site-url";

interface ProbeTarget {
  siteId: string;
  origin: string;
  routes: string[];
  sentinels: string[];
}

interface TargetsFile {
  schemaVersion: number;
  targets: ProbeTarget[];
}

async function resolveExpectedTargets(
  root: string,
  context: KernelRuntimeContext,
): Promise<Map<string, string>> {
  const appsDir = join(root, "apps");
  const appDirs = await context.io.glob("*/", { cwd: appsDir });
  const result = new Map<string, string>();
  for (const appDirName of appDirs) {
    const siteId = appDirName.replace(/\/$/, "");
    const appDir = join(appsDir, siteId);
    const origin = await readAstroSiteUrl(appDir);
    if (origin) result.set(siteId, origin);
  }
  return result;
}

async function resolveAppSiteIds(
  root: string,
  context: KernelRuntimeContext,
): Promise<Set<string>> {
  const appsDir = join(root, "apps");
  const appDirs = await context.io.glob("*/", { cwd: appsDir });
  return new Set(appDirs.map((d) => d.replace(/\/$/, "")));
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export async function runFleetProbeValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const diagnostics: Diagnostic[] = [];
  const root = context.workspaceRoot;
  const targetsPath = join(root, "services", "fleet-probe-runner", "targets.generated.yaml");
  const runnerDir = join(root, "services", "fleet-probe-runner");

  // FLEET-PRB-04: runner must not import from apps/*
  const runnerFiles = await context.io.glob("src/**/*.ts", { cwd: runnerDir });
  for (const file of runnerFiles) {
    const text = await context.io.readFile(join(runnerDir, file));
    if (text.includes('from "@warpgogol/') || text.includes('from "apps/')) {
      // Check for apps/* imports specifically
      if (/from\s+["']\.\.\/\.\.\/apps\//.test(text) || /from\s+["']apps\//.test(text)) {
        diagnostics.push({
          ruleId: "FLEET-PRB-04",
          severity: "error",
          file: `services/fleet-probe-runner/${file}`,
          message: "Runner imports from apps/* — boundary violation (RFC-0304).",
          fixHint: "Move shared logic to a package; services must not import from apps.",
        });
      }
    }
  }

  // Check targets.generated.yaml exists
  if (!(await context.io.exists(targetsPath))) {
    diagnostics.push({
      ruleId: "FLEET-PRB-01",
      severity: "error",
      file: "services/fleet-probe-runner/targets.generated.yaml",
      message: "targets.generated.yaml does not exist — run fleet.probe.targets.generate.",
      fixHint: "Run: pnpm exec werkstatt run fleet.probe.targets.generate",
    });
    return diagnosticsResult("fleet.probe.validate", diagnostics);
  }

  const rawText = await context.io.readFile(targetsPath);
  let targetsFile: TargetsFile;
  try {
    targetsFile = yamlParse(rawText) as TargetsFile;
  } catch {
    diagnostics.push({
      ruleId: "FLEET-PRB-02",
      severity: "error",
      file: "services/fleet-probe-runner/targets.generated.yaml",
      message: "targets.generated.yaml is not valid YAML.",
      fixHint: "Regenerate: pnpm exec werkstatt run fleet.probe.targets.generate",
    });
    return diagnosticsResult("fleet.probe.validate", diagnostics);
  }

  // FLEET-PRB-02: schema validation
  for (const target of targetsFile.targets) {
    if (!isValidUrl(target.origin)) {
      diagnostics.push({
        ruleId: "FLEET-PRB-02",
        severity: "error",
        file: "services/fleet-probe-runner/targets.generated.yaml",
        message: `Target "${target.siteId}" has invalid origin URL: ${target.origin}`,
        fixHint: "Fix the origin in targets.overrides.yaml or the app's astro.config.mjs.",
      });
    }
    if (!target.routes || target.routes.length === 0) {
      diagnostics.push({
        ruleId: "FLEET-PRB-02",
        severity: "error",
        file: "services/fleet-probe-runner/targets.generated.yaml",
        message: `Target "${target.siteId}" has no routes.`,
        fixHint: "Add routes in targets.overrides.yaml.",
      });
    }
    for (const sentinel of target.sentinels ?? []) {
      if (!isValidRegex(sentinel)) {
        diagnostics.push({
          ruleId: "FLEET-PRB-02",
          severity: "error",
          file: "services/fleet-probe-runner/targets.generated.yaml",
          message: `Target "${target.siteId}" has invalid sentinel regex: ${sentinel}`,
          fixHint: "Fix the sentinel pattern in targets.overrides.yaml.",
        });
      }
    }
  }

  // FLEET-PRB-03: all target origins must belong to the fleet
  const expectedOrigins = await resolveExpectedTargets(root, context);
  const knownHosts = new Set<string>();
  for (const origin of expectedOrigins.values()) {
    try {
      knownHosts.add(new URL(origin).hostname);
    } catch {
      // skip invalid
    }
  }
  for (const target of targetsFile.targets) {
    let host: string;
    try {
      host = new URL(target.origin).hostname;
    } catch {
      continue; // already flagged by FLEET-PRB-02
    }
    if (!knownHosts.has(host)) {
      diagnostics.push({
        ruleId: "FLEET-PRB-03",
        severity: "error",
        file: "services/fleet-probe-runner/targets.generated.yaml",
        message: `Target "${target.siteId}" origin host "${host}" is not in the fleet — this runner must not probe third parties.`,
        fixHint: "Remove the target or add an app workspace with this origin.",
      });
    }
  }

  // FLEET-PRB-05: app workspaces without a target entry and no exclude
  const appSiteIds = await resolveAppSiteIds(root, context);
  const targetSiteIds = new Set(targetsFile.targets.map((t) => t.siteId));

  // Check overrides for excluded sites
  const overridesPath = join(root, "services", "fleet-probe-runner", "targets.overrides.yaml");
  let excludedSiteIds = new Set<string>();
  if (await context.io.exists(overridesPath)) {
    const overridesText = await context.io.readFile(overridesPath);
    try {
      const overrides = yamlParse(overridesText) as Array<{ siteId?: string; exclude?: boolean }>;
      excludedSiteIds = new Set(
        overrides.filter((o) => o.exclude && o.siteId).map((o) => o.siteId!),
      );
    } catch {
      // ignore parse errors
    }
  }

  for (const siteId of appSiteIds) {
    if (!targetSiteIds.has(siteId) && !excludedSiteIds.has(siteId)) {
      // Check if the app has an origin (skip if no origin configured)
      const hasOrigin = expectedOrigins.has(siteId);
      if (hasOrigin) {
        diagnostics.push({
          ruleId: "FLEET-PRB-05",
          severity: "warning",
          file: "services/fleet-probe-runner/targets.generated.yaml",
          message: `App "${siteId}" has no probe target entry and no explicit exclude.`,
          fixHint: `Add "${siteId}" to targets.overrides.yaml or set "exclude": true with a reason.`,
        });
      }
    }
  }

  return diagnosticsResult("fleet.probe.validate", diagnostics);
}
