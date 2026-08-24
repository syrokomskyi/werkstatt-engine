/*
<MODULE_CONTRACT>
<purpose>
RFC-0266: generates the single machine-readable command manifest —
docs/command-manifest.generated.yaml — from the live Site OS command
registry (workspace + every discovered app). Every other command-surface
projection (docs/COMMANDS.md, the ecosystem projection's command section,
CLI --help) should read from this manifest instead of independently
re-walking the registry, so a command's own declaration is the single source
of truth for its documentation, IO, and pipeline membership.
</purpose>
<non-goals>
  <item>Do not enforce reads/writes at runtime — that is rfc-0267 (WorkspaceIO port).</item>
  <item>Do not regenerate turbo.json — that is rfc-0259 Step 2.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0266: initial implementation.</item>
  <item>Post-refactor hardening: expose reusable manifest diagnostics collection to avoid duplicate registry walks.</item>
</CHANGE_SUMMARY>
*/

import { createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { buildGeneratedHeader } from "./generated-marker.ts";
import { writeFileAtomic } from "./fs-atomic.ts";
import { listRegisteredKernelCommands, listRegisteredKernelPipelines } from "./runtime.ts";
import type {
  CheckResult,
  Diagnostic,
  KernelCommandInput,
  KernelCommandResult,
  KernelFlagSpec,
  KernelRuntimeContext,
} from "./types.ts";

export interface CommandManifestEntry {
  name: string;
  description: string;
  scope: "app" | "workspace";
  provider: string;
  module: string | null;
  mutatesState: boolean;
  requiresNetwork: boolean;
  timeoutMs: number | null;
  flags: Record<string, KernelFlagSpec>;
  reads: string[];
  writes: string[];
  validatesOutputs: string[];
  pipelines: string[];
}

export interface CommandManifest {
  meta: { schemaVersion: 1; deterministic: true; generatedAt: null; contentHash: string };
  commands: CommandManifestEntry[];
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

  return diagnostics;
}

/** Builds the deterministic CommandManifest from the live command + pipeline registries. */
export async function buildCommandManifest(workspaceRoot: string): Promise<CommandManifest> {
  const [commands, pipelinesByName] = await Promise.all([
    listRegisteredKernelCommands(workspaceRoot),
    listRegisteredKernelPipelines(workspaceRoot),
  ]);

  const pipelinesByCommand = new Map<string, Set<string>>();
  for (const [pipelineName, memberCommands] of Object.entries(pipelinesByName)) {
    for (const commandName of memberCommands) {
      const set = pipelinesByCommand.get(commandName) ?? new Set<string>();
      set.add(pipelineName);
      pipelinesByCommand.set(commandName, set);
    }
  }

  const entries: CommandManifestEntry[] = commands.map((command) => ({
    name: command.name,
    description: command.description,
    scope: command.scope,
    provider: command.siteName ? `${command.provider}:${command.siteName}` : command.provider,
    module: command.module ?? null,
    mutatesState: command.mutatesState === true,
    requiresNetwork: command.requiresNetwork === true,
    timeoutMs: command.timeoutMs ?? null,
    flags: command.flags ?? {},
    reads: command.reads ?? [],
    writes: command.writes ?? [],
    validatesOutputs: command.validatesOutputs ?? [],
    pipelines: [...(pipelinesByCommand.get(command.name) ?? [])].sort(),
  }));

  entries.sort((a, b) => a.name.localeCompare(b.name) || a.provider.localeCompare(b.provider));

  const withoutHash: Omit<CommandManifest, "meta"> & {
    meta: Omit<CommandManifest["meta"], "contentHash">;
  } = {
    meta: { schemaVersion: 1, deterministic: true, generatedAt: null },
    commands: entries,
  };
  const contentHash = createHash("sha256").update(yamlStringify(withoutHash)).digest("hex");

  return { ...withoutHash, meta: { ...withoutHash.meta, contentHash } };
}

export async function runCommandManifestGenerate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<
  KernelCommandResult<{
    command: "command.manifest.generate";
    commandCount: number;
    written: boolean;
  }>
> {
  const dryRun = context.dryRun || input.flags["dry-run"] === true;
  const manifest = await buildCommandManifest(context.workspaceRoot);

  if (!dryRun) {
    const outputPath = manifestFilePath(context.workspaceRoot);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFileAtomic(
      outputPath,
      `${buildGeneratedHeader({ filePath: MANIFEST_RELATIVE_PATH, ownerCommand: "command.manifest.generate" })}${yamlStringify(manifest)}\n`,
    );
  }

  return {
    data: {
      command: "command.manifest.generate",
      commandCount: manifest.commands.length,
      written: !dryRun,
    },
    exitCode: 0,
    summary: dryRun
      ? `command.manifest.generate: dry-run — ${manifest.commands.length} command(s)`
      : `command.manifest.generate: wrote ${manifest.commands.length} command(s)`,
  };
}

export async function runCommandManifestValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const current = await buildCommandManifest(context.workspaceRoot);

  let committedRaw: string | undefined;
  try {
    committedRaw = await readFile(manifestFilePath(context.workspaceRoot), "utf8");
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
    summary: `command.manifest.validate: ${summary.error} error${summary.error === 1 ? "" : "s"}, ${summary.warning} warning${summary.warning === 1 ? "" : "s"}`,
  };
}
