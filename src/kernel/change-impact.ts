/*
<MODULE_CONTRACT>
<purpose>
RFC-0332: Change impact classifier — derives impact class and advisory
check profiles from changed paths. Pure, data-driven, no CI gating.
</purpose>
<non-goals>
  <item>No CI gating — advisory only, DNA-35 remains the readiness signal.</item>
  <item>No hand-authored risk field — risk is derived from changed paths.</item>
  <item>No dependency-graph analysis — path-pattern classification only in v1.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0332: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";

import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "./types.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ImpactClass = "none" | "low" | "medium" | "high";

export interface ImpactRule {
  pattern: string;
  class: ImpactClass;
  ruleId: string;
}

export interface PathClassification {
  path: string;
  class: ImpactClass;
  ruleId: string;
}

export interface ImpactClassification {
  overall: ImpactClass;
  perPath: PathClassification[];
}

export interface ProfileRecommendation {
  commands: string[];
  note: string;
}

export interface ChangeImpactResult {
  command: "change.impact.derive";
  status: "ok";
  mode: "paths" | "git-base" | "working-tree";
  overall: ImpactClass;
  impactedApps: string[];
  perPath: PathClassification[];
  recommendation: ProfileRecommendation;
}

// ─── Rules table ─────────────────────────────────────────────────────────────

const CLASS_ORDER: Record<ImpactClass, number> = { none: 0, low: 1, medium: 2, high: 3 };

export const IMPACT_RULES: ImpactRule[] = [
  { pattern: "AGENTS.md", class: "high", ruleId: "IMP-AGENT-POLICY" },
  { pattern: "apps/**/AGENTS.md", class: "high", ruleId: "IMP-AGENT-POLICY" },
  { pattern: "services/**/AGENTS.md", class: "high", ruleId: "IMP-AGENT-POLICY" },
  { pattern: "packages/**/AGENTS.md", class: "high", ruleId: "IMP-AGENT-POLICY" },
  { pattern: "packages/os/**", class: "high", ruleId: "IMP-OS" },
  { pattern: "packages/share/**", class: "high", ruleId: "IMP-SHARE" },
  { pattern: "turbo.json", class: "high", ruleId: "IMP-ROOT-CONFIG" },
  { pattern: "pnpm-workspace.yaml", class: "high", ruleId: "IMP-ROOT-CONFIG" },
  { pattern: "pnpm-lock.yaml", class: "high", ruleId: "IMP-ROOT-CONFIG" },
  { pattern: "package.json", class: "high", ruleId: "IMP-ROOT-CONFIG" },
  { pattern: "docs/requirements.xml", class: "high", ruleId: "IMP-COMPASS" },
  { pattern: "docs/technology.xml", class: "high", ruleId: "IMP-COMPASS" },
  { pattern: "docs/development-plan.xml", class: "high", ruleId: "IMP-COMPASS" },
  { pattern: "docs/knowledge-graph.xml", class: "high", ruleId: "IMP-COMPASS" },
  { pattern: "docs/verification-plan.xml", class: "high", ruleId: "IMP-COMPASS" },
  { pattern: "docs/source-markup.xml", class: "high", ruleId: "IMP-COMPASS" },
  { pattern: "docs/styling.xml", class: "high", ruleId: "IMP-COMPASS" },
  { pattern: "packages/ui/**", class: "medium", ruleId: "IMP-UI-ONTOLOGY" },
  { pattern: "packages/ontology/**", class: "medium", ruleId: "IMP-UI-ONTOLOGY" },
  { pattern: "packages/**", class: "medium", ruleId: "IMP-PKG" },
  { pattern: "apps/*/astro.config.*", class: "medium", ruleId: "IMP-APP-CONFIG" },
  { pattern: "apps/*/system.md", class: "medium", ruleId: "IMP-APP-CONFIG" },
  { pattern: "apps/*/package.json", class: "medium", ruleId: "IMP-APP-CONFIG" },
  { pattern: "apps/*/src/content/**", class: "low", ruleId: "IMP-CONTENT" },
  { pattern: "apps/**", class: "medium", ruleId: "IMP-APP-CODE" },
  { pattern: "docs/rfcs/**", class: "low", ruleId: "IMP-RFC" },
  { pattern: "docs/rfcs-audit/**", class: "none", ruleId: "IMP-DOCS" },
  { pattern: "docs/**", class: "none", ruleId: "IMP-DOCS" },
  { pattern: "*.md", class: "none", ruleId: "IMP-DOCS" },
  { pattern: ".agents/**", class: "none", ruleId: "IMP-DOCS" },
  { pattern: "**", class: "medium", ruleId: "IMP-UNKNOWN" },
];

// ─── Glob matching ───────────────────────────────────────────────────────────

function globMatch(pattern: string, path: string): boolean {
  // Simple glob matcher supporting **, *, and exact paths
  // Convert glob to regex
  let re = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "::GLOBSTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::GLOBSTAR::/g, ".*");
  // Anchor to start
  re = `^${re}$`;
  return new RegExp(re).test(path);
}

// ─── Pure classifier ─────────────────────────────────────────────────────────

export function classifyPaths(paths: string[]): ImpactClassification {
  const perPath: PathClassification[] = [];
  let overall: ImpactClass = "none";

  for (const p of paths) {
    const normalized = p.replace(/\\/g, "/").replace(/^\.\//, "");
    let matched = false;
    for (const rule of IMPACT_RULES) {
      if (globMatch(rule.pattern, normalized)) {
        perPath.push({ path: normalized, class: rule.class, ruleId: rule.ruleId });
        if (CLASS_ORDER[rule.class] > CLASS_ORDER[overall]) {
          overall = rule.class;
        }
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Should never reach here due to IMP-UNKNOWN catch-all
      perPath.push({ path: normalized, class: "medium", ruleId: "IMP-UNKNOWN" });
      if (CLASS_ORDER.medium > CLASS_ORDER[overall]) overall = "medium";
    }
  }

  return { overall, perPath };
}

export function deriveImpactedApps(paths: string[], appNames: string[]): string[] {
  const impacted = new Set<string>();
  const hasWorkspaceBlast = paths.some((p) => {
    const normalized = p.replace(/\\/g, "/");
    return (
      normalized.startsWith("packages/") ||
      normalized === "AGENTS.md" ||
      normalized.startsWith("turbo.json") ||
      normalized.startsWith("pnpm-workspace.yaml") ||
      normalized.startsWith("pnpm-lock.yaml") ||
      normalized === "package.json" ||
      normalized.startsWith("docs/requirements.xml") ||
      normalized.startsWith("docs/technology.xml") ||
      normalized.startsWith("docs/development-plan.xml") ||
      normalized.startsWith("docs/knowledge-graph.xml") ||
      normalized.startsWith("docs/verification-plan.xml") ||
      normalized.startsWith("docs/source-markup.xml") ||
      normalized.startsWith("docs/styling.xml")
    );
  });

  if (hasWorkspaceBlast) return [...appNames].sort();

  for (const p of paths) {
    const normalized = p.replace(/\\/g, "/");
    const appMatch = normalized.match(/^apps\/([^/]+)\//);
    if (appMatch) {
      const appName = appMatch[1]!;
      if (appNames.includes(appName)) impacted.add(appName);
    }
  }

  return [...impacted].sort();
}

export function recommendProfile(
  classification: ImpactClassification,
  impactedApps: string[],
): ProfileRecommendation {
  const note = "Advisory only. app.contract.full remains the readiness signal (DNA-35).";
  const commands: string[] = [];

  // IMP-RFC always adds rfc.validate
  const hasRfcPaths = classification.perPath.some((p) => p.ruleId === "IMP-RFC");
  if (hasRfcPaths) commands.push("rfc.validate");

  switch (classification.overall) {
    case "none":
      return { commands, note };
    case "low":
      for (const app of impactedApps) commands.push(`sites-check.author --site ${app}`);
      return { commands, note };
    case "medium":
      for (const app of impactedApps) commands.push(`sites-check.run --site ${app}`);
      commands.push("packages-check.run");
      return { commands, note };
    case "high":
      for (const app of impactedApps) commands.push(`app.contract.full --site ${app}`);
      return { commands, note };
  }
}

// ─── Command handler ─────────────────────────────────────────────────────────

function gitDiffNames(workspaceRoot: string, args: string[]): string[] {
  const result = execSync(`git diff --name-only ${args.join(" ")}`, {
    cwd: workspaceRoot,
    encoding: "utf-8",
  });
  return result.trim().split("\n").filter(Boolean);
}

function gitStatusPorcelain(workspaceRoot: string): string[] {
  const result = execSync("git status --porcelain", {
    cwd: workspaceRoot,
    encoding: "utf-8",
  });
  return result
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
}

export async function runChangeImpactDerive(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ChangeImpactResult>> {
  const { workspaceRoot, logger, outputFormat } = context;
  const pathsFlag = input.flags["paths"] as string | undefined;
  const gitBase = input.flags["git-base"] as string | undefined;

  let mode: ChangeImpactResult["mode"];
  let paths: string[];

  if (pathsFlag) {
    mode = "paths";
    paths = pathsFlag
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (gitBase) {
      logger.warn("--paths takes precedence over --git-base; ignoring --git-base.");
    }
  } else if (gitBase) {
    mode = "git-base";
    try {
      paths = gitDiffNames(workspaceRoot, [`${gitBase}...HEAD`]);
    } catch (err) {
      throw new Error(`git diff failed: ${String(err)}`);
    }
  } else {
    mode = "working-tree";
    try {
      const unstaged = gitDiffNames(workspaceRoot, []);
      const staged = gitDiffNames(workspaceRoot, ["--cached"]);
      const untracked = gitStatusPorcelain(workspaceRoot).filter(
        (p) => !unstaged.includes(p) && !staged.includes(p),
      );
      paths = [...new Set([...unstaged, ...staged, ...untracked])];
    } catch (err) {
      throw new Error(`git command failed: ${String(err)}`);
    }
  }

  const classification = classifyPaths(paths);

  // Discover app names from workspace
  const appNames: string[] = [];
  try {
    const { discoverWorkspacePackages } = await import("./workspace-discovery.ts");
    const discovery = await discoverWorkspacePackages(workspaceRoot);
    for (const pkg of discovery.packages) {
      if (pkg.directory.startsWith("apps/")) {
        appNames.push(pkg.directory.replace("apps/", ""));
      }
    }
  } catch {
    // graceful — no apps discovered
  }

  const impactedApps = deriveImpactedApps(paths, appNames);
  const recommendation = recommendProfile(classification, impactedApps);

  const result: ChangeImpactResult = {
    command: "change.impact.derive",
    status: "ok",
    mode,
    overall: classification.overall,
    impactedApps,
    perPath: classification.perPath,
    recommendation,
  };

  if (outputFormat === "pretty") {
    logger.section(`Change impact: ${classification.overall}`);
    const byClass: Record<string, number> = {};
    for (const p of classification.perPath) {
      byClass[p.class] = (byClass[p.class] ?? 0) + 1;
    }
    for (const cls of ["high", "medium", "low", "none"]) {
      if (byClass[cls]) logger.info(`  ${cls}: ${byClass[cls]} path(s)`);
    }
    if (impactedApps.length > 0) {
      logger.info(`  Impacted apps: ${impactedApps.join(", ")}`);
    }
    if (recommendation.commands.length > 0) {
      logger.info("  Recommended:");
      for (const cmd of recommendation.commands) logger.info(`    ${cmd}`);
    }
    logger.info(`  ${recommendation.note}`);
  }

  return {
    data: result,
    exitCode: 0,
    summary: `[change.impact.derive] overall=${classification.overall}, ${paths.length} path(s), ${impactedApps.length} app(s)`,
  };
}
