/**
 * <MODULE_CONTRACT>
 *   <purpose>RFC-1296: per-release content warning budget — warning counts per
 *            rule for content contracts plus the delta against the previous
 *            release, recorded at releases/&lt;id&gt;/content-warnings.json.</purpose>
 *   <role>Release / engine</role>
 *   <consumers>release-commands.ts (release.prepare), editorial.review.* (EDIT-05)</consumers>
 *   <change_rules>
 *     <item>Only validators whose command contract is in CONTENT_CONTRACTS
 *           contribute — infrastructure checks are not content warnings.</item>
 *   </change_rules>
 * </MODULE_CONTRACT>
 */

/**
 * Contracts whose diagnostics describe rendered/editorial content quality.
 * A validator contributes to the budget only when its command's contract is
 * listed here.
 */
export const CONTENT_CONTRACTS = [
  "text-corpus",
  "typography",
  "list-punctuation",
  "pbp-terms-reference",
  "pbp",
  "surface",
  "content",
  "content-voice",
  "dist",
  "price",
  "seo",
  "editorial",
] as const;

export interface ContentWarningsRule {
  warning: number;
  error: number;
  previous: number | null;
  delta: number | null;
}

export interface ContentWarnings {
  schema: "werkstatt/content-warnings@1";
  releaseId: string;
  previousReleaseId: string | null;
  rules: Record<string, ContentWarningsRule>;
  /** ruleIds whose warning count grew versus the previous release. */
  increased: string[];
}

export interface ValidationReportLike {
  contractFull?: {
    validators?: Array<{
      name: string;
      rules?: Record<string, { error: number; warning: number }>;
    }>;
  };
}

function collectContentRules(
  report: ValidationReportLike,
  contractOf: (command: string) => string | undefined,
): Record<string, { warning: number; error: number }> {
  const out: Record<string, { warning: number; error: number }> = {};
  const contentSet = new Set<string>(CONTENT_CONTRACTS);
  for (const v of report.contractFull?.validators ?? []) {
    const contract = contractOf(v.name);
    if (!contract || !contentSet.has(contract)) continue;
    for (const [ruleId, counts] of Object.entries(v.rules ?? {})) {
      const bucket = (out[ruleId] ??= { warning: 0, error: 0 });
      bucket.warning += counts.warning ?? 0;
      bucket.error += counts.error ?? 0;
    }
  }
  return out;
}

export function computeContentWarnings(
  current: ValidationReportLike,
  previous: ValidationReportLike | null,
  contractOf: (command: string) => string | undefined,
  releaseId: string,
  previousReleaseId: string | null,
): ContentWarnings {
  const currentRules = collectContentRules(current, contractOf);
  const previousRules = previous ? collectContentRules(previous, contractOf) : {};

  const rules: Record<string, ContentWarningsRule> = {};
  const increased: string[] = [];
  for (const [ruleId, counts] of Object.entries(currentRules)) {
    const prev = previousRules[ruleId]?.warning ?? null;
    const delta = prev === null ? null : counts.warning - prev;
    rules[ruleId] = { warning: counts.warning, error: counts.error, previous: prev, delta };
    if (delta !== null && delta > 0) increased.push(ruleId);
  }

  return {
    schema: "werkstatt/content-warnings@1",
    releaseId,
    previousReleaseId,
    rules,
    increased: increased.sort(),
  };
}

// ---------------------------------------------------------------------------
// release.prepare integration — contractOf resolution + content-warnings.json
// ---------------------------------------------------------------------------

import path from "node:path";
import { parse as parseYaml } from "yaml";

import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel";
import { getOrBuildWorkspaceRegistry } from "../kernel/runtime/registry-cache.ts";

async function readReport(file: string, io: WorkspaceIO): Promise<ValidationReportLike | null> {
  try {
    return JSON.parse(await io.readFile(file)) as ValidationReportLike;
  } catch {
    return null;
  }
}

/**
 * command → contract. Registry-first (`KernelCommandDefinition.contract`),
 * falling back to `docs/validator-inventory.generated.yaml` when the registry
 * cannot be built (the generated manifest does not emit contract fields).
 */
export async function buildContractOf(
  workspaceRoot: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<(command: string) => string | undefined> {
  try {
    const registry = await getOrBuildWorkspaceRegistry(workspaceRoot);
    if (registry) {
      const map = new Map<string, string>();
      for (const [name, def] of registry.commands) {
        const contract = (def as { contract?: string }).contract;
        if (contract) map.set(name, contract);
      }
      if (map.size > 0) return (command) => map.get(command);
    }
  } catch {
    // registry unavailable — manifest fallback
  }

  const inventoryPath = path.join(workspaceRoot, "docs", "validator-inventory.generated.yaml");
  let map = new Map<string, string>();
  try {
    const raw = await io.readFile(inventoryPath);
    const parsed = parseYaml(raw) as {
      contracts?: Array<{ contract?: string; validators?: Array<{ command?: string }> }>;
    };
    for (const c of parsed.contracts ?? []) {
      if (!c.contract) continue;
      for (const v of c.validators ?? []) {
        if (v.command) map.set(v.command, c.contract);
      }
    }
  } catch {
    map = new Map();
  }
  return (command) => map.get(command);
}

/** Highest `releases/<systemId>-r*` below `releaseId` carrying a validation report. */
export async function findPreviousReleaseWithReport(
  workspaceRoot: string,
  systemId: string,
  releaseId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string | null> {
  const releasesDir = path.join(workspaceRoot, "releases");
  let entries: Array<{ name: string; isDirectory: boolean }>;
  try {
    entries = await io.readdir(releasesDir);
  } catch {
    return null;
  }
  const candidates = entries
    .map((e) => e.name)
    .filter((n) => n.startsWith(`${systemId}-r`) && n < releaseId && !n.includes(".staging-"))
    .sort()
    .reverse();
  for (const name of candidates) {
    if (await io.exists(path.join(releasesDir, name, "validation-report.json"))) {
      return name;
    }
  }
  return null;
}

/** Write `content-warnings.json` into the release staging dir. */
export async function writeContentWarnings(
  workspaceRoot: string,
  stagingDir: string,
  systemId: string,
  releaseId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const current = await readReport(path.join(stagingDir, "validation-report.json"), io);
  if (!current) return; // no report staged — nothing to budget

  const previousReleaseId = await findPreviousReleaseWithReport(
    workspaceRoot,
    systemId,
    releaseId,
    io,
  );
  const previous = previousReleaseId
    ? await readReport(
        path.join(workspaceRoot, "releases", previousReleaseId, "validation-report.json"),
        io,
      )
    : null;

  const contractOf = await buildContractOf(workspaceRoot, io);
  const warnings = computeContentWarnings(
    current,
    previous,
    contractOf,
    releaseId,
    previousReleaseId,
  );
  await io.writeFile(
    path.join(stagingDir, "content-warnings.json"),
    JSON.stringify(warnings, null, 2) + "\n",
  );
}
