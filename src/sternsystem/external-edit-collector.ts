/*
<MODULE_CONTRACT>
<purpose>RFC-0520: extracted I/O collector for the Bordbuch-vs-git-log external edit guard.</purpose>
<non-goals>
  <item>Does not contain guard logic — that lives in external-edit-guard.ts as a pure function.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0520: initial extraction of Bordbuch reading and git rev-list I/O from sternsystem.validate inline block.</item>
  <item>ADR-0040: add JSDoc return-type contract to bordbuchPathFor.</item>
  <item>ADR-0091: collect externalEditBaselineSha from system-state.yaml via loose read — malformed values reach the guard as baseline-missing.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { parse as parseYaml } from "yaml";

export interface ExternalEditCollectorOutput {
  bordbuchEntries: Array<{
    type?: string;
    metadata?: { commitSha?: string; preReconcileSha?: string };
  }>;
  rangeShas: string[];
  gitLogShas: string[];
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
        type?: string;
        metadata?: { commitSha?: string; preReconcileSha?: string };
      };
      bordbuchEntries.push(entry);
      if (entry.type === "mission-reconcile" && entry.metadata?.commitSha) {
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
  const logResult = await io.exec("git", ["rev-list", "--all"], { cwd: cacheDir });
  if (logResult.exitCode === 0) {
    gitLogShas = logResult.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter((l) => l.length > 0);
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

  return { bordbuchEntries, rangeShas, gitLogShas, externalEditBaselineSha };
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
