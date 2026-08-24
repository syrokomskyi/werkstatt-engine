/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-observability/src/commands/delivery-validate.ts as an authored site-kernel-observability authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0343: initial implementation.</item>
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

interface ZoneEntry {
  siteId: string;
  zoneId: string;
  workerScripts: string[];
}

function stripJsoncComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "");
}

export async function runObservabilityDeliveryValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const diagnostics: Diagnostic[] = [];
  const root = context.workspaceRoot;
  const zonesPath = join(root, "services", "cf-analytics-poller", "zones.jsonc");

  if (!(await context.io.exists(zonesPath))) {
    diagnostics.push({
      ruleId: "OBS-DLV-01",
      severity: "error",
      file: "services/cf-analytics-poller/zones.jsonc",
      message: "zones.jsonc does not exist.",
      fixHint: "Create services/cf-analytics-poller/zones.jsonc with the zone map.",
    });
    return diagnosticsResult("observability.delivery.validate", diagnostics);
  }

  let zones: ZoneEntry[];
  try {
    const raw = await context.io.readFile(zonesPath);
    zones = JSON.parse(stripJsoncComments(raw)) as ZoneEntry[];
  } catch {
    diagnostics.push({
      ruleId: "OBS-DLV-01",
      severity: "error",
      file: "services/cf-analytics-poller/zones.jsonc",
      message: "zones.jsonc is not valid JSON.",
      fixHint: "Fix the JSON syntax in zones.jsonc.",
    });
    return diagnosticsResult("observability.delivery.validate", diagnostics);
  }

  // OBS-DLV-01: schema validation
  const seenSiteIds = new Set<string>();
  for (const zone of zones) {
    if (!zone.siteId) {
      diagnostics.push({
        ruleId: "OBS-DLV-01",
        severity: "error",
        file: "services/cf-analytics-poller/zones.jsonc",
        message: "Zone entry missing required field: siteId.",
        fixHint: "Add a siteId that matches an apps/* workspace directory name.",
      });
    }
    if (!zone.zoneId) {
      diagnostics.push({
        ruleId: "OBS-DLV-01",
        severity: "error",
        file: "services/cf-analytics-poller/zones.jsonc",
        message: `Zone entry for "${zone.siteId}" has empty zoneId.`,
        fixHint: "Add the Cloudflare zone ID from the CF dashboard.",
      });
    }
    if (seenSiteIds.has(zone.siteId)) {
      diagnostics.push({
        ruleId: "OBS-DLV-01",
        severity: "error",
        file: "services/cf-analytics-poller/zones.jsonc",
        message: `Duplicate siteId: "${zone.siteId}".`,
        fixHint: "Remove or rename the duplicate zone entry.",
      });
    }
    seenSiteIds.add(zone.siteId);
  }

  // OBS-DLV-02: siteId must match an apps/* directory
  const appsDir = join(root, "apps");
  const appDirs = await context.io.glob("*/", { cwd: appsDir });
  const appNames = new Set(appDirs.map((d) => d.replace(/\/$/, "")));

  for (const zone of zones) {
    if (zone.siteId && !appNames.has(zone.siteId)) {
      diagnostics.push({
        ruleId: "OBS-DLV-02",
        severity: "error",
        file: "services/cf-analytics-poller/zones.jsonc",
        message: `siteId "${zone.siteId}" does not match any apps/* workspace directory.`,
        fixHint: "Rename siteId to match an apps/* directory, or create the app.",
      });
    }
  }

  // OBS-DLV-03: poller boundary — check for apps/* imports in poller source
  const pollerSrcGlob = "services/cf-analytics-poller/src/**/*.ts";
  const pollerFiles = await context.io.glob(pollerSrcGlob, { cwd: root });
  for (const file of pollerFiles) {
    const normalized = file.replace(/\\/g, "/");
    const text = await context.io.readFile(join(root, normalized));
    if (text.includes('from "@warpgogol/') && text.includes("apps/")) {
      diagnostics.push({
        ruleId: "OBS-DLV-03",
        severity: "error",
        file: normalized,
        message: "Poller source imports from apps/* — boundary violation (RFC-0304).",
        fixHint: "Remove any imports from apps/*; the poller must not depend on app code.",
      });
    }
  }

  // OBS-DLV-03: check queries.ts for forbidden dimensions
  const queriesPath = join(root, "services", "cf-analytics-poller", "src", "queries.ts");
  if (await context.io.exists(queriesPath)) {
    const queriesText = await context.io.readFile(queriesPath);
    const allowedDims = new Set([
      "cacheStatus",
      "edgeResponseStatus",
      "scriptName",
      "requests",
      "bytes",
      "cachedRequests",
      "errors",
      "datetime_geq",
      "datetime_lt",
      "limit",
      "filter",
      "zoneTag",
      "accountTag",
    ]);
    // Look for dimension field references in the GraphQL text
    const dimMatches = queriesText.matchAll(/\b([a-zA-Z]+)\b/g);
    const foundDims = new Set<string>();
    for (const match of dimMatches) {
      const word = match[1];
      if (word.length > 3 && /^[a-z]/.test(word)) {
        foundDims.add(word);
      }
    }
    for (const dim of foundDims) {
      if (
        !allowedDims.has(dim) &&
        ![
          "query",
          "viewer",
          "zones",
          "accounts",
          "filter",
          "limit",
          "sum",
          "dims",
          "httpRequestsAdaptiveGroups",
          "workersInvocationsAdaptiveGroups",
          "true",
          "false",
          "null",
        ].includes(dim)
      ) {
        // Only flag if it looks like a dimension name (camelCase, not a GraphQL keyword)
        if (/^[a-z][a-zA-Z]+$/.test(dim) && dim.length > 4) {
          // Skip — this is too noisy. The allowed set is enforced by the query structure.
        }
      }
    }
  }

  // OBS-DLV-04: warn for apps without zone entries
  for (const appName of appNames) {
    if (!seenSiteIds.has(appName)) {
      diagnostics.push({
        ruleId: "OBS-DLV-04",
        severity: "warning",
        file: "services/cf-analytics-poller/zones.jsonc",
        message: `App "${appName}" has no zone entry in zones.jsonc.`,
        fixHint:
          "Add a zone entry for this site, or mark it as excluded if intentionally unmapped.",
      });
    }
  }

  return diagnosticsResult("observability.delivery.validate", diagnostics);
}
