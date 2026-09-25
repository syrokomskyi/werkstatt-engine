/*
<MODULE_CONTRACT>
<purpose>
Closed-mission workpiece immutability (ADR-0085, ADR-0087): detect the `.closed`
sentinel, reduce declared `writes[]` patterns to concrete paths, batch-resolve
gitignore status via `git check-ignore --stdin`, and decide whether a mutating
command may run on a closed workpiece. Shared by execute-pipeline.ts (step-level
early skip for reporting/telemetry) and execute-command.ts (executor-level
enforcement floor for all invocation paths, including direct executeKernelCommand
calls).
</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Leaf module — imported by both execute-command.ts and execute-pipeline.ts; must not import either (cycle).</item>
  <item>Gitignored-writes exemption: mutating commands run only when every declared write resolves gitignored — uncommittable churn is impossible.</item>
  <item>No git tracking (collectGitignoredPaths → null) means no write can churn a commit — the command runs.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>ADR-0087: extract closed-workpiece helpers from execute-pipeline.ts into this leaf module so execute-command.ts can enforce the same guard without an import cycle; add mutatingCommandRunsOnClosedWorkpiece (single-call predicate for the executor path).</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import type {
  DiscoveredSiteWorkspace,
  KernelCommandDefinition,
} from "@warpgogol/werkstatt-shared/kernel";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

// @ai-invariant: Closed-mission workpieces are immutable — a mutating command may run only when every declared write resolves to a gitignored path.

export const CLOSED_WORKPIECE_SENTINEL = ".closed";

/**
 * ADR-0085: detect a closed-mission workpiece via the `.closed` sentinel
 * written by mission.close (RFC-0878). A closed workpiece is immutable —
 * writes to git-tracked files can never be committed and produce only
 * uncommittable churn.
 */
export async function isClosedWorkpiece(siteDirectory: string, io: WorkspaceIO): Promise<boolean> {
  return io.exists(join(siteDirectory, CLOSED_WORKPIECE_SENTINEL));
}

/**
 * ADR-0085: reduce a declared `writes[]` pattern to a concrete path (relative
 * to the site directory) suitable for `git check-ignore`. The `<app>/` prefix
 * is stripped, `{placeholder}` segments become a literal, and the path is cut
 * at the first glob character — `git check-ignore` matches parent directories,
 * so `dist/client` is reported ignored when `dist/` is ignored.
 * Returns null for patterns outside the site directory (non-`<app>` prefixes)
 * or patterns that cannot be reduced to a concrete prefix.
 */
export function writePatternToCheckPath(pattern: string, siteName: string): string | null {
  if (!pattern.startsWith("<app>/")) return null;
  let rel = pattern.slice("<app>/".length);
  rel = rel.replaceAll("{app}", siteName).replace(/\{[a-zA-Z0-9_-]+\}/g, "x");
  const globIndex = rel.search(/[*?[\]]/);
  if (globIndex >= 0) rel = rel.slice(0, globIndex);
  rel = rel.replace(/\/+$/, "");
  return rel.length > 0 ? rel : null;
}

/**
 * ADR-0085: batch-resolve which candidate paths are gitignored inside the site
 * directory via a single `git check-ignore --stdin` call. Returns null when
 * the site directory is not a git repository or git is unavailable — without
 * git tracking no write can produce committable churn, so callers treat every
 * path as untracked.
 */
export async function collectGitignoredPaths(
  siteDirectory: string,
  candidatePaths: string[],
  io: WorkspaceIO,
): Promise<Set<string> | null> {
  if (candidatePaths.length === 0) return new Set();
  try {
    const result = await io.exec("git", ["check-ignore", "--", ...candidatePaths], {
      cwd: siteDirectory,
    });
    if (result.exitCode === 1) return new Set();
    if (result.exitCode !== 0) return null;
    return new Set(
      result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    // ENOENT (no git binary) → no git tracking at all → null (nothing can
    // churn a non-repo workpiece).
    return null;
  }
}

/**
 * ADR-0085: a mutating step may run on a closed workpiece only when every
 * declared write resolves to a gitignored path inside the site directory —
 * such writes cannot produce committable churn and are required by
 * release.prepare's rebuild path (passport.emit, dist mutators). Steps with
 * no declared writes, writes outside the site directory, or writes to tracked
 * paths are skipped. `ignoredPaths === null` means no git tracking — all
 * writes are uncommittable, so the step runs.
 */
export function mutatingStepRunsOnClosedWorkpiece(
  command: KernelCommandDefinition,
  siteName: string,
  ignoredPaths: Set<string> | null,
): boolean {
  if (ignoredPaths === null) return true;
  const writes = command.writes ?? [];
  if (writes.length === 0) return false;
  return writes.every((pattern) => {
    const checkPath = writePatternToCheckPath(pattern, siteName);
    return checkPath !== null && ignoredPaths.has(checkPath);
  });
}

/**
 * ADR-0087: single-call predicate for the executor path — resolves gitignore
 * status internally (one `git check-ignore --stdin` spawn per call, only on
 * closed workpieces). The pipeline keeps its own batched resolution across
 * all steps; direct executeKernelCommand callers get the same decision here.
 */
export async function mutatingCommandRunsOnClosedWorkpiece(
  command: KernelCommandDefinition,
  site: DiscoveredSiteWorkspace,
  io: WorkspaceIO,
): Promise<boolean> {
  const candidates = (command.writes ?? [])
    .map((pattern) => writePatternToCheckPath(pattern, site.name))
    .filter((p): p is string => p !== null);
  const ignoredPaths = await collectGitignoredPaths(site.directory, candidates, io);
  return mutatingStepRunsOnClosedWorkpiece(command, site.name, ignoredPaths);
}
