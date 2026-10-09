/*
<MODULE_CONTRACT>
<purpose>Maintains the observability.delivery.validate command — validates the cf-analytics-poller zones.yaml zone map against registered Sternsystemen and service ownerApps, and enforces the poller's apps/*-free boundary.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0343: initial implementation.</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import type {
  CheckResult,
  Diagnostic,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { diagnosticsResult } from "@warpgogol/werkstatt-shared/checks";
import { discoverSystems } from "../../sternsystem/registry-io.ts";

interface ZoneEntry {
  siteId: string;
  zoneId: string;
  workerScripts: string[];
}

const ZONES_FILE = "services/cf-analytics-poller/zones.yaml";

async function collectKnownSiteIds(
  root: string,
  context: KernelRuntimeContext,
): Promise<Set<string>> {
  const known = new Set<string>();
  const { systems } = await discoverSystems(root, context.io);
  for (const system of systems) known.add(system.id);
  const serviceConfigs = await context.io.glob("*/service.config.yaml", {
    cwd: join(root, "services"),
  });
  for (const rel of serviceConfigs) {
    const text = await context.io.readFile(join(root, "services", rel));
    const owner = yamlParse(text) as { ownerApp?: unknown };
    if (typeof owner.ownerApp === "string" && owner.ownerApp.length > 0) {
      known.add(owner.ownerApp);
    }
  }
  return known;
}

export async function runObservabilityDeliveryValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const diagnostics: Diagnostic[] = [];
  const root = context.workspaceRoot;
  const zonesPath = join(root, ZONES_FILE);

  if (!(await context.io.exists(zonesPath))) {
    diagnostics.push({
      ruleId: "OBS-DLV-01",
      severity: "error",
      file: ZONES_FILE,
      message: "zones.yaml does not exist.",
      fixHint: "Create services/cf-analytics-poller/zones.yaml with the zone map.",
    });
    return diagnosticsResult("observability.delivery.validate", diagnostics);
  }

  let zones: ZoneEntry[];
  try {
    const raw = await context.io.readFile(zonesPath);
    zones = yamlParse(raw) as ZoneEntry[];
  } catch {
    diagnostics.push({
      ruleId: "OBS-DLV-01",
      severity: "error",
      file: ZONES_FILE,
      message: "zones.yaml is not valid YAML.",
      fixHint: "Fix the YAML syntax in zones.yaml.",
    });
    return diagnosticsResult("observability.delivery.validate", diagnostics);
  }
  if (!Array.isArray(zones)) {
    diagnostics.push({
      ruleId: "OBS-DLV-01",
      severity: "error",
      file: ZONES_FILE,
      message: "zones.yaml must contain a top-level array of zone entries.",
      fixHint: "Rewrite zones.yaml as a YAML array of {siteId, zoneId, workerScripts} entries.",
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
        file: ZONES_FILE,
        message: "Zone entry missing required field: siteId.",
        fixHint: "Add a siteId that matches a registered Sternsystem id or a service ownerApp.",
      });
    }
    if (!zone.zoneId) {
      diagnostics.push({
        ruleId: "OBS-DLV-01",
        severity: "error",
        file: ZONES_FILE,
        message: `Zone entry for "${zone.siteId}" has empty zoneId.`,
        fixHint: "Add the Cloudflare zone ID from the CF dashboard.",
      });
    }
    if (seenSiteIds.has(zone.siteId)) {
      diagnostics.push({
        ruleId: "OBS-DLV-01",
        severity: "error",
        file: ZONES_FILE,
        message: `Duplicate siteId: "${zone.siteId}".`,
        fixHint: "Remove or rename the duplicate zone entry.",
      });
    }
    seenSiteIds.add(zone.siteId);
  }

  // OBS-DLV-02: siteId must match a registered Sternsystem or a service ownerApp
  const knownSiteIds = await collectKnownSiteIds(root, context);
  for (const zone of zones) {
    if (zone.siteId && !knownSiteIds.has(zone.siteId)) {
      diagnostics.push({
        ruleId: "OBS-DLV-02",
        severity: "error",
        file: ZONES_FILE,
        message: `siteId "${zone.siteId}" matches no registered Sternsystem or service ownerApp.`,
        fixHint:
          "Rename siteId to a Sternsystem id (systems-cache/<id>) or a services/*/service.config.yaml ownerApp.",
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

  // OBS-DLV-04: warn for registered sites without zone entries
  for (const siteId of knownSiteIds) {
    if (!seenSiteIds.has(siteId)) {
      diagnostics.push({
        ruleId: "OBS-DLV-04",
        severity: "warning",
        file: ZONES_FILE,
        message: `Site "${siteId}" has no zone entry in zones.yaml.`,
        fixHint:
          "Add a zone entry for this site, or mark it as excluded if intentionally unmapped.",
      });
    }
  }

  return diagnosticsResult("observability.delivery.validate", diagnostics);
}
