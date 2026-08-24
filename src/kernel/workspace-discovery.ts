/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/workspace-discovery.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not execute package scripts or load application modules.</item>
  <item>Do not implement the full pnpm glob language beyond supported repository patterns.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0253: add shared workspace discovery for ACP, workspace surface, and test signal checks.</item>
</CHANGE_SUMMARY>
*/

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse } from "yaml";
import type { Diagnostic } from "./types.ts";

export interface WorkspacePackageInfo {
  name: string;
  directory: string;
  absoluteDirectory: string;
  packageJsonPath: string;
  workspacePattern: string;
  kind: "app" | "package" | "os-package" | "service" | "mission" | "other";
  packageJson: {
    name?: string;
    version?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    gogol?: unknown;
  };
}

export interface WorkspaceDiscoveryResult {
  workspaceRoot: string;
  packageGlobs: string[];
  packages: WorkspacePackageInfo[];
  diagnostics: Diagnostic[];
}

type WorkspacePackageJson = WorkspacePackageInfo["packageJson"];

const PNPM_WORKSPACE_PATH = "pnpm-workspace.yaml";

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

function workspaceDiscoveryDiagnostic(
  suffix: "01" | "02" | "03" | "04",
  message: string,
  fixHint: string,
  data?: Record<string, unknown>,
): Diagnostic {
  return {
    ruleId: `WORKSPACE-DISCOVERY-${suffix}`,
    severity: "error",
    file: PNPM_WORKSPACE_PATH,
    message,
    fixHint,
    ...(data ? { data } : {}),
  };
}

function workspacePackageGlobsFromYaml(source: string, _diagnostics: Diagnostic[]): string[] {
  const parsed = parse(source) as { packages?: unknown };
  if (!Array.isArray(parsed.packages)) return [];
  return parsed.packages
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => entry.trim().length > 0);
}

function isSupportedWorkspacePattern(pattern: string): boolean {
  const rawPattern = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  return rawPattern
    .split("/")
    .filter(Boolean)
    .every((segment) => segment === "*" || /^[a-zA-Z0-9._-]+$/.test(segment));
}

async function expandWorkspacePattern(workspaceRoot: string, pattern: string): Promise<string[]> {
  const segments = pattern.split("/").filter(Boolean);
  let candidates = [workspaceRoot];

  for (const segment of segments) {
    const nextCandidates: string[] = [];
    for (const candidate of candidates) {
      if (segment === "*") {
        let entries;
        try {
          entries = await readdir(candidate, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("-"))
            continue;
          nextCandidates.push(join(candidate, entry.name));
        }
        continue;
      }
      nextCandidates.push(join(candidate, segment));
    }
    candidates = nextCandidates;
  }

  const packageDirectories: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(join(candidate, "package.json"))) packageDirectories.push(candidate);
  }
  return packageDirectories;
}

export function workspacePackageKind(directory: string): WorkspacePackageInfo["kind"] {
  const normalized = toPosixPath(directory);
  if (normalized.startsWith("apps/")) return "app";
  if (normalized.startsWith("packages/os/")) return "os-package";
  if (normalized.startsWith("packages/")) return "package";
  if (normalized.startsWith("services/")) return "service";
  if (normalized.startsWith("missions/")) return "mission";
  return "other";
}

export async function discoverWorkspacePackages(
  workspaceRoot: string,
): Promise<WorkspaceDiscoveryResult> {
  const diagnostics: Diagnostic[] = [];
  const workspaceSource = await readFile(join(workspaceRoot, PNPM_WORKSPACE_PATH), "utf8");
  const rawPackageGlobs = workspacePackageGlobsFromYaml(workspaceSource, diagnostics);
  const packageGlobs = rawPackageGlobs
    .filter((pattern) => !pattern.startsWith("!"))
    .sort((a, b) => a.localeCompare(b));
  const negativeGlobs = rawPackageGlobs
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1))
    .sort((a, b) => a.localeCompare(b));
  const unsupportedPatterns = rawPackageGlobs.filter(
    (pattern) => !isSupportedWorkspacePattern(pattern),
  );

  for (const pattern of unsupportedPatterns) {
    diagnostics.push(
      workspaceDiscoveryDiagnostic(
        "03",
        `Workspace pattern ${pattern} is not supported by the shared discovery helper.`,
        "Use literal path segments and * wildcards, or extend discoverWorkspacePackages with a tested parser before using this pattern.",
        { workspacePattern: pattern },
      ),
    );
  }

  const byDirectory = new Map<
    string,
    { absoluteDirectory: string; workspacePattern: string; matches: string[] }
  >();
  for (const pattern of packageGlobs.filter((pattern) => isSupportedWorkspacePattern(pattern))) {
    for (const absoluteDirectory of await expandWorkspacePattern(workspaceRoot, pattern)) {
      const directory = toPosixPath(relative(workspaceRoot, absoluteDirectory));
      const existing = byDirectory.get(directory);
      if (!existing) {
        byDirectory.set(directory, {
          absoluteDirectory,
          workspacePattern: pattern,
          matches: [pattern],
        });
        continue;
      }
      existing.matches.push(pattern);
      if (pattern.localeCompare(existing.workspacePattern) < 0) existing.workspacePattern = pattern;
    }
  }

  for (const pattern of negativeGlobs.filter((pattern) => isSupportedWorkspacePattern(pattern))) {
    for (const absoluteDirectory of await expandWorkspacePattern(workspaceRoot, pattern)) {
      byDirectory.delete(toPosixPath(relative(workspaceRoot, absoluteDirectory)));
    }
  }

  const packages: WorkspacePackageInfo[] = [];
  for (const [directory, entry] of [...byDirectory.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (entry.matches.length > 1) {
      diagnostics.push(
        workspaceDiscoveryDiagnostic(
          "04",
          `Workspace package ${directory} is matched by multiple patterns.`,
          "Keep workspace package globs non-overlapping, or rely on the deterministic lexicographic tie-break recorded in workspacePattern.",
          {
            directory,
            workspacePatterns: entry.matches.sort((a, b) => a.localeCompare(b)),
            selectedPattern: entry.workspacePattern,
          },
        ),
      );
    }

    const kind = workspacePackageKind(directory);
    if (kind === "other") {
      diagnostics.push(
        workspaceDiscoveryDiagnostic(
          "01",
          `Workspace package ${directory} is not classified.`,
          "Add an explicit package kind rule for this workspace directory family.",
          { directory, workspacePattern: entry.workspacePattern },
        ),
      );
    }

    const packageJsonPath = join(entry.absoluteDirectory, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as WorkspacePackageJson;
    if (!packageJson.name) {
      diagnostics.push(
        workspaceDiscoveryDiagnostic(
          "02",
          `Workspace package ${directory} is missing package.json name.`,
          "Set package.json name so workspace package discovery can identify it.",
          { directory, workspacePattern: entry.workspacePattern },
        ),
      );
    }

    packages.push({
      name: packageJson.name ?? directory,
      directory,
      absoluteDirectory: entry.absoluteDirectory,
      packageJsonPath,
      workspacePattern: entry.workspacePattern,
      kind,
      packageJson,
    });
  }

  return {
    workspaceRoot,
    packageGlobs,
    packages,
    diagnostics,
  };
}
