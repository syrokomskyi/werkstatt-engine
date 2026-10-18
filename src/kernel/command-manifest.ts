/*
<MODULE_CONTRACT>
<purpose>
RFC-0266/RFC-1147: generates the single machine-readable command manifest —
docs/command-manifest.generated.yaml — from the static command surface
(workspace registry + canonical site module set, SITE_MODULE_MAP). Every other
command-surface projection (docs/COMMANDS.md, the ecosystem projection's
command section, CLI --help) should read from this manifest instead of
independently re-walking the registry, so a command's own declaration is the
single source of truth for its documentation, IO, and pipeline membership.
</purpose>
<non-goals>
  <item>Do not enforce reads/writes at runtime — that is rfc-0267 (WorkspaceIO port).</item>
  <item>Do not regenerate turbo.json — that is rfc-0259 Step 2.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>The manifest is generated, not hand-maintained — docs/command-manifest.generated.yaml is the single output.</item>
  <item>Command metadata comes from the static command surface (listStaticCommandSurface), not from doc parsing or discovered site instances.</item>
  <item>Deduplication is fail-closed (CMD-MAN-04): same-name commands across providers merge only when semantic fields agree.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <item>RFC-1254: drop unused io-migration leftovers</item>
  <item>RFC-1306 review-r1: manifest write migrated ambient writeFileAtomic to context.io via writeFileIfChanged — dry-run/readonly interception + honest filesModified.</item>
  <item>RFC-1320: dry-run now returns renderedFiles (canonical io-native dry-run contract) — generated.drift.validate --target=workspace can byte-verify the manifest instead of reporting render-unavailable.</item>
  <item>RFC-1334: steps 1-3 — shared structural reachability, reachableVia in the command manifest, coverage validator on the shared scan</item>
  <history>CMD-MAN-04, RFC-0266, RFC-1097, RFC-1147</history>
</CHANGE_SUMMARY>
*/

import { createHash } from "node:crypto";
import { join } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { buildGeneratedHeader } from "./generated-marker.ts";
import {
  computeCommandReachability,
  INVOKER_SOURCE_GLOBS,
  isInvokerSource,
  writeFileIfChanged,
  type ReachabilityEdge,
} from "@warpgogol/werkstatt-shared/kernel";
import { globSync, readFileSync } from "node:fs";
import { listStaticCommandSurface } from "./runtime.ts";
import type {
  CheckResult,
  Diagnostic,
  KernelCommandCoverage,
  KernelCommandInput,
  KernelCommandResult,
  KernelFlagSpec,
  KernelRegisteredCommandInfo,
  KernelRuntimeContext,
  ModuleExport,
} from "@warpgogol/werkstatt-shared/kernel";
import { failResult } from "@warpgogol/werkstatt-shared/checks/result-helpers";

export interface CommandManifestEntry {
  name: string;
  description: string;
  scope: "app" | "workspace";
  /** Sorted unique providers that register this command (workspace, site-module). */
  providers: string[];
  /** True when the command is registered by the canonical site module set (RFC-1147). */
  siteScope: boolean;
  module: string | null;
  mutatesState: boolean;
  requiresNetwork: boolean;
  timeoutMs: number | null;
  /** RFC-1243: reachability class declaration, null when undeclared. */
  coverage: KernelCommandCoverage | null;
  /** RFC-1243: invocation-surface note paired with `coverage`, null when absent. */
  coverageNote: string | null;
  flags: Record<string, KernelFlagSpec>;
  reads: string[];
  writes: string[];
  validatesOutputs: string[];
  pipelines: string[];
  /** RFC-1334: structural reachability (pipeline | invoker | coverage), sorted. */
  reachableVia: ReachabilityEdge[];
}

export interface CommandManifest {
  meta: { schemaVersion: 1; deterministic: true; generatedAt: null; contentHash: string };
  commands: CommandManifestEntry[];
}

/** Thrown by buildCommandManifest when same-name commands diverge across providers (CMD-MAN-04). */
export class CommandManifestDedupError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(
      `Command manifest deduplication failed: ${diagnostics.length} conflict(s). ` +
        "Same-name commands across providers must agree on semantic fields.",
    );
    this.name = "CommandManifestDedupError";
    this.diagnostics = diagnostics;
  }
}

const MANIFEST_RELATIVE_PATH = join("docs", "command-manifest.generated.yaml");

export function manifestFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, MANIFEST_RELATIVE_PATH);
}

export function collectCommandManifestDiagnostics(
  current: CommandManifest,
  committedRaw: string | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (committedRaw === undefined) {
    diagnostics.push({
      ruleId: "CMD-MAN-01",
      severity: "error",
      file: MANIFEST_RELATIVE_PATH.replace(/\\/g, "/"),
      message: "docs/command-manifest.generated.yaml is missing.",
      fixHint: "Run: pnpm exec werkstatt run command.manifest.generate",
    });
    return diagnostics;
  }

  let committed: CommandManifest;
  try {
    committed = yamlParse(committedRaw);
  } catch {
    diagnostics.push({
      ruleId: "CMD-MAN-01",
      severity: "error",
      file: MANIFEST_RELATIVE_PATH.replace(/\\/g, "/"),
      message: "docs/command-manifest.generated.yaml is not valid YAML.",
      fixHint: "Run: pnpm exec werkstatt run command.manifest.generate",
    });
    return diagnostics;
  }

  if (committed.meta?.contentHash !== current.meta.contentHash) {
    diagnostics.push({
      ruleId: "CMD-MAN-01",
      severity: "error",
      file: MANIFEST_RELATIVE_PATH.replace(/\\/g, "/"),
      message: "docs/command-manifest.generated.yaml is stale vs the live command registry.",
      fixHint: "Run: pnpm exec werkstatt run command.manifest.generate",
    });
  }

  for (const entry of current.commands) {
    if (entry.mutatesState && entry.writes.length === 0) {
      diagnostics.push({
        ruleId: "CMD-MAN-02",
        severity: "warning",
        message: `Command "${entry.name}" declares mutatesState: true but no writes.`,
        fixHint:
          "Declare the writes: [] glob(s) this command produces, or set mutatesState: false if it does not mutate the filesystem.",
        data: { command: entry.name },
      });
    }
  }

  // RFC-1243 (CMD-MAN-05): coverage declarations must stay inside the enum.
  // Checked on the committed file — it is the parsed (untyped) "manifest
  // declaration"; code-side illegal values land here via generation anyway.
  for (const entry of (committed.commands ?? []).map((command) => ({
    command: command.name,
    coverage: (command as { coverage?: unknown }).coverage,
  }))) {
    if (
      entry.coverage !== null &&
      entry.coverage !== undefined &&
      !COMMAND_COVERAGE_VALUES.has(entry.coverage as KernelCommandCoverage)
    ) {
      diagnostics.push({
        ruleId: "CMD-MAN-05",
        severity: "error",
        message:
          `Command "${entry.command}" declares coverage "${String(entry.coverage)}" — ` +
          `legal values are: ${[...COMMAND_COVERAGE_VALUES].join(", ")}.`,
        fixHint:
          "Set coverage to one of operator | ci | delegated, or remove it and wire the command into a reachable surface (RFC-1243).",
        data: { command: entry.command, coverage: entry.coverage },
      });
    }
  }

  return diagnostics;
}

const COMMAND_COVERAGE_VALUES: ReadonlySet<KernelCommandCoverage> = new Set([
  "operator",
  "ci",
  "delegated",
]);

/** Builds the deterministic CommandManifest from the static command surface (RFC-1147). */
export async function buildCommandManifest(
  workspaceRoot: string,
  siteModules?: Record<string, () => Promise<ModuleExport>>,
): Promise<CommandManifest> {
  const surface = await listStaticCommandSurface(workspaceRoot, siteModules);

  const pipelinesByCommand = new Map<string, Set<string>>();
  for (const [pipelineName, memberCommands] of Object.entries(surface.pipelines)) {
    for (const commandName of memberCommands) {
      const set = pipelinesByCommand.get(commandName) ?? new Set<string>();
      set.add(pipelineName);
      pipelinesByCommand.set(commandName, set);
    }
  }

  const entries = dedupCommandEntries(surface.commands, pipelinesByCommand);

  // RFC-1334: invocation literals in source decide invoker edges — reading
  // sources makes the manifest drift (CMD-MAN-01) when an invocation changes.
  const sources = new Map<string, string>();
  for (const pattern of INVOKER_SOURCE_GLOBS) {
    for (const rel of globSync(pattern, { cwd: workspaceRoot })) {
      const normalized = String(rel).replace(/\\/g, "/");
      if (!isInvokerSource(normalized) || sources.has(normalized)) continue;
      sources.set(normalized, readFileSync(join(workspaceRoot, normalized), "utf8"));
    }
  }
  const reachability = computeCommandReachability({ commands: entries, sources });
  for (const entry of entries) entry.reachableVia = reachability.get(entry.name) ?? [];

  const withoutHash: Omit<CommandManifest, "meta"> & {
    meta: Omit<CommandManifest["meta"], "contentHash">;
  } = {
    meta: { schemaVersion: 1, deterministic: true, generatedAt: null },
    commands: entries,
  };
  const contentHash = createHash("sha256").update(yamlStringify(withoutHash)).digest("hex");

  return { ...withoutHash, meta: { ...withoutHash.meta, contentHash } };
}

/**
 * Semantic fields compared across providers for same-name commands (CMD-MAN-04).
 * Provenance fields (module, provider, siteName) are excluded — they differ by
 * construction.
 */
const SEMANTIC_FIELDS = [
  "description",
  "scope",
  "mutatesState",
  "requiresNetwork",
  "timeoutMs",
  "coverage",
  "coverageNote",
  "flags",
  "reads",
  "writes",
  "validatesOutputs",
] as const;

type SemanticField = (typeof SEMANTIC_FIELDS)[number];

/** Canonicalize a value for cross-provider comparison: sort object keys recursively, keep array order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function semanticFieldValue(command: KernelRegisteredCommandInfo, field: SemanticField): unknown {
  switch (field) {
    case "mutatesState":
      return command.mutatesState === true;
    case "requiresNetwork":
      return command.requiresNetwork === true;
    case "timeoutMs":
      return command.timeoutMs ?? null;
    case "coverage":
      return command.coverage ?? null;
    case "coverageNote":
      return command.coverageNote ?? null;
    case "flags":
      return command.flags ?? {};
    case "reads":
      return command.reads ?? [];
    case "writes":
      return command.writes ?? [];
    case "validatesOutputs":
      return command.validatesOutputs ?? [];
    default:
      return command[field];
  }
}

/**
 * Merge per-provider command entries into one manifest entry per name.
 * Fail-closed (CMD-MAN-04): throws CommandManifestDedupError when same-name
 * commands disagree on any semantic field.
 */
function dedupCommandEntries(
  commands: KernelRegisteredCommandInfo[],
  pipelinesByCommand: Map<string, Set<string>>,
): CommandManifestEntry[] {
  const byName = new Map<string, KernelRegisteredCommandInfo[]>();
  for (const command of commands) {
    const group = byName.get(command.name) ?? [];
    group.push(command);
    byName.set(command.name, group);
  }

  const diagnostics: Diagnostic[] = [];
  const entries: CommandManifestEntry[] = [];

  for (const [name, group] of byName) {
    const divergentFields = SEMANTIC_FIELDS.filter((field) => {
      const fingerprints = new Set(
        group.map((command) => JSON.stringify(canonicalize(semanticFieldValue(command, field)))),
      );
      return fingerprints.size > 1;
    });

    const providers = [...new Set(group.map((command) => command.provider))].sort();

    if (divergentFields.length > 0) {
      diagnostics.push({
        ruleId: "CMD-MAN-04",
        severity: "error",
        message:
          `Command "${name}" is registered by ${providers.length} providers ` +
          `(${providers.join(", ")}) with divergent declarations: ${divergentFields.join(", ")}.`,
        fixHint:
          "Align the command declarations across providers, or rename one of the commands. " +
          "The manifest is a stable surface — same-name commands must be semantically identical.",
        data: { command: name, providers, fields: divergentFields },
      });
      continue;
    }

    // All providers agree — merge. Module provenance: prefer the site-module
    // registration (canonical site surface), fall back to any non-null module.
    const siteModuleEntry = group.find((command) => command.provider === "site-module");
    const representative = siteModuleEntry ?? group[0];
    const module =
      siteModuleEntry?.module ?? group.find((command) => command.module)?.module ?? null;

    entries.push({
      name,
      description: representative.description,
      scope: representative.scope,
      providers,
      siteScope: providers.includes("site-module"),
      module,
      mutatesState: representative.mutatesState === true,
      requiresNetwork: representative.requiresNetwork === true,
      timeoutMs: representative.timeoutMs ?? null,
      coverage: representative.coverage ?? null,
      coverageNote: representative.coverageNote ?? null,
      flags: representative.flags ?? {},
      reads: representative.reads ?? [],
      writes: representative.writes ?? [],
      validatesOutputs: representative.validatesOutputs ?? [],
      pipelines: [...(pipelinesByCommand.get(name) ?? [])].sort(),
      reachableVia: [],
    });
  }

  if (diagnostics.length > 0) {
    throw new CommandManifestDedupError(diagnostics);
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

export async function runCommandManifestGenerate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<
  KernelCommandResult<{
    command: "command.manifest.generate";
    commandCount: number;
    written: boolean;
    renderedFiles?: Record<string, string>;
    diagnostics?: Diagnostic[];
  }>
> {
  const dryRun = context.dryRun || input.flags["dry-run"] === true;

  let manifest: CommandManifest;
  try {
    manifest = await buildCommandManifest(context.workspaceRoot);
  } catch (err) {
    if (err instanceof CommandManifestDedupError) {
      return {
        ...failResult("command.manifest.generate", [
          `aborted — ${err.diagnostics.length} dedup conflict(s) (CMD-MAN-04)`,
        ]),
        data: {
          command: "command.manifest.generate",
          commandCount: 0,
          written: false,
          diagnostics: err.diagnostics,
        },
      };
    }
    throw err;
  }

  const content = `${buildGeneratedHeader({ filePath: MANIFEST_RELATIVE_PATH, ownerCommand: "command.manifest.generate" })}${yamlStringify(manifest)}\n`;

  // RFC-1320: dry-run must surface renderedFiles — generated.drift.validate
  // byte-compares the manifest through them (emit's EVIDENCE-FRESH gate).
  if (dryRun) {
    return {
      data: {
        command: "command.manifest.generate",
        commandCount: manifest.commands.length,
        written: false,
        renderedFiles: { [MANIFEST_RELATIVE_PATH.replace(/\\/g, "/")]: content },
      },
      exitCode: 0,
      summary: `[command.manifest.generate] dry-run — ${manifest.commands.length} command(s)`,
    };
  }

  const outputPath = manifestFilePath(context.workspaceRoot);
  // RFC-1306 review: write through the io port (atomic + mkdir built in) so
  // the artifact write lands in filesModified, and skip byte-identical
  // rewrites so a synced tree reports zero changes.
  await writeFileIfChanged(context.io, outputPath, content);

  return {
    data: {
      command: "command.manifest.generate",
      commandCount: manifest.commands.length,
      written: !dryRun,
    },
    exitCode: 0,
    summary: dryRun
      ? `[command.manifest.generate] dry-run — ${manifest.commands.length} command(s)`
      : `[command.manifest.generate] wrote ${manifest.commands.length} command(s)`,
  };
}

export async function runCommandManifestValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  let current: CommandManifest;
  try {
    current = await buildCommandManifest(context.workspaceRoot);
  } catch (err) {
    if (err instanceof CommandManifestDedupError) {
      return diagnosticsResultLocal(err.diagnostics);
    }
    throw err;
  }

  let committedRaw: string | undefined;
  try {
    committedRaw = await context.io.readFile(manifestFilePath(context.workspaceRoot));
  } catch {
    committedRaw = undefined;
  }

  const diagnostics = collectCommandManifestDiagnostics(current, committedRaw);
  return diagnosticsResultLocal(diagnostics);
}

function diagnosticsResultLocal(diagnostics: Diagnostic[]): KernelCommandResult<CheckResult> {
  const summary = {
    error: diagnostics.filter((d) => d.severity === "error").length,
    warning: diagnostics.filter((d) => d.severity === "warning").length,
    info: diagnostics.filter((d) => d.severity === "info").length,
  };
  const status: CheckResult["status"] =
    summary.error > 0 ? "fail" : summary.warning > 0 ? "warn" : "pass";
  return {
    data: { command: "command.manifest.validate", status, diagnostics, summary },
    exitCode: summary.error > 0 ? 1 : 0,
    summary: `[command.manifest.validate] ${summary.error} error${summary.error === 1 ? "" : "s"}, ${summary.warning} warning${summary.warning === 1 ? "" : "s"}`,
  };
}
