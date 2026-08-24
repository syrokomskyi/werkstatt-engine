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
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export interface ExternalEditCollectorOutput {
  bordbuchEntries: Array<{
    type?: string;
    metadata?: { commitSha?: string; preReconcileSha?: string };
  }>;
  rangeShas: string[];
  gitLogShas: string[];
}

export async function collectExternalEditInputs(
  cacheDir: string,
  bordbuchPath: string,
): Promise<ExternalEditCollectorOutput> {
  const bordbuchRaw = await fs.readFile(bordbuchPath, "utf8");
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
          try {
            const range = execSync(
              `git rev-list ${entry.metadata.preReconcileSha}..${entry.metadata.commitSha}`,
              { cwd: cacheDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
            ).trim();
            for (const sha of range.split("\n").filter((l) => l.trim())) {
              rangeShas.push(sha.trim());
            }
          } catch {
            // Range may be invalid if history was rewritten — skip
          }
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  let gitLogShas: string[] = [];
  try {
    const log = execSync("git rev-list --all", {
      cwd: cacheDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    gitLogShas = log
      .split("\n")
      .map((s) => s.trim())
      .filter((l) => l.length > 0);
  } catch {
    // No commits or git error — skip
  }

  return { bordbuchEntries, rangeShas, gitLogShas };
}

export function bordbuchFileExists(cacheDir: string): boolean {
  const bordbuchPath = path.join(cacheDir, "bordbuch", "events.ndjson");
  const gitDir = path.join(cacheDir, ".git");
  return existsSync(bordbuchPath) && existsSync(gitDir);
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
