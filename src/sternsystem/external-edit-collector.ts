/*
<MODULE_CONTRACT>
<purpose>RFC-0520: extracted I/O collector for the Bordbuch-vs-git-log external edit guard.</purpose>
<non-goals>
  <item>Does not contain guard logic — that lives in external-edit-guard.ts as a pure function.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0040: add JSDoc return-type contract to bordbuchPathFor.</item>
  <item>ADR-0091: collect externalEditBaselineSha from system-state.yaml via loose read — malformed values reach the guard as baseline-missing.</item>
  <item>RFC-0520 follow-up: read bordbuch `kind` field (the schema field — `type` never existed, so every commit was untraced) and collect git subjects so the guard can whitelist pipeline bookkeeping commits.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>ADR-0093: collect mergedShas[] from mission-reconcile entry metadata so the guard can trace every merged workpiece commit.</item>
  <history>RFC-0520</history>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { parse as parseYaml } from "yaml";

export interface ExternalEditCollectorOutput {
  bordbuchEntries: Array<{
    kind?: string;
    metadata?: { commitSha?: string; preReconcileSha?: string; mergedShas?: string[] };
  }>;
  rangeShas: string[];
  gitLogShas: string[];
  /** Commit subjects aligned with gitLogShas order — used by the guard to
   * whitelist machine-authored pipeline bookkeeping commits (Bordbuch:,
   * chore:, system-state:, …) that can never carry a forward trace. */
  gitLogSubjects: string[];
  // ADR-0091: optional baseline SHA from system-state.yaml — undefined when the
  // field is absent or the state file cannot be read.
  externalEditBaselineSha?: string;
}

export async function collectExternalEditInputs(
  cacheDir: string,
  bordbuchPath: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<ExternalEditCollectorOutput> {
  const bordbuchRaw = await io.readFile(bordbuchPath);
  const lines = bordbuchRaw.split("\n").filter((l) => l.trim().length > 0);

  const bordbuchEntries: ExternalEditCollectorOutput["bordbuchEntries"] = [];
  const rangeShas: string[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as {
        kind?: string;
        metadata?: { commitSha?: string; preReconcileSha?: string; mergedShas?: string[] };
      };
      bordbuchEntries.push(entry);
      if (entry.kind === "mission-reconcile" && entry.metadata?.commitSha) {
        if (entry.metadata.preReconcileSha) {
          const rangeResult = await io.exec(
            "git",
            ["rev-list", `${entry.metadata.preReconcileSha}..${entry.metadata.commitSha}`],
            { cwd: cacheDir },
          );
          if (rangeResult.exitCode === 0) {
            for (const sha of rangeResult.stdout.split("\n").filter((l) => l.trim())) {
              rangeShas.push(sha.trim());
            }
          }
          // Non-zero exit: range may be invalid if history was rewritten — skip
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  let gitLogShas: string[] = [];
  let gitLogSubjects: string[] = [];
  const logResult = await io.exec("git", ["log", "--all", "--format=%H%x00%s"], { cwd: cacheDir });
  if (logResult.exitCode === 0) {
    for (const line of logResult.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const sep = trimmed.indexOf("\x00");
      if (sep === -1) {
        gitLogShas.push(trimmed);
        gitLogSubjects.push("");
      } else {
        gitLogShas.push(trimmed.slice(0, sep));
        gitLogSubjects.push(trimmed.slice(sep + 1));
      }
    }
  }

  // ADR-0091: loose read of the baseline field — no full schema parse, so a
  // malformed value still reaches the guard and surfaces as the precise
  // external-edit-baseline-missing violation instead of silently disabling the
  // check. systemStateSchema enforces the 40-hex format on canonical readers.
  let externalEditBaselineSha: string | undefined;
  try {
    const stateRaw = await io.readFile(path.join(cacheDir, "system-state.yaml"));
    const stateParsed = parseYaml(stateRaw) as { externalEditBaselineSha?: unknown } | null;
    if (typeof stateParsed?.externalEditBaselineSha === "string") {
      externalEditBaselineSha = stateParsed.externalEditBaselineSha;
    }
  } catch {
    // Missing or unparseable state file — baseline unset, guard runs unfiltered
  }

  return { bordbuchEntries, rangeShas, gitLogShas, gitLogSubjects, externalEditBaselineSha };
}

export async function bordbuchFileExists(
  cacheDir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<boolean> {
  const bordbuchPath = path.join(cacheDir, "bordbuch", "events.ndjson");
  const gitDir = path.join(cacheDir, ".git");
  return (await io.exists(bordbuchPath)) && (await io.exists(gitDir));
}

/**
 * Computes the bordbuch events.ndjson path for a cache directory.
 *
 * @returns The computed bordbuch file path. Always returns a string — the
 *          file may not exist on disk. Callers MUST check with
 *          `existsSync` before relying on the path.
 */
export function bordbuchPathFor(cacheDir: string): string {
  return path.join(cacheDir, "bordbuch", "events.ndjson");
}
