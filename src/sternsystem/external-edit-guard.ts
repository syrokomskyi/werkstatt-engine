/*
<MODULE_CONTRACT>
<purpose>external-edit-guard — pure external-edit guard extracted from the sternsystem.validate inline block (RFC-0520).</purpose>
<non-goals>
  <item>Does not read Bordbuch or run git rev-list — the caller gathers I/O and passes results.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0520: initial extraction of Bordbuch-vs-git-log guard as pure function.</item>
  <item>ADR-0091: add externalEditBaselineSha input — positional grandfathering of pre-baseline rev-list commits and external-edit-baseline-missing violation.</item>
  <item>RFC-0520 follow-up: read bordbuch `kind` field (the `type` field never existed — guard was silently dead) and whitelist pipeline bookkeeping subject prefixes so machine-authored commits pass.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { GuardResult } from "../handoff/guards.ts";

/**
 * Commit subjects the pipeline authors itself in the cache clone — bordbuch
 * ledger commits, state/pin/materialization bookkeeping, merges, rescues.
 * These can never be traced by a forward-referencing entry (the entry's own
 * commit SHA cannot be known before the entry is hash-chained and written),
 * so they are whitelisted by convention. A human/external edit with any other
 * subject still flags.
 */
const PIPELINE_SUBJECT_PREFIXES = [
  "Bordbuch:",
  "chore:",
  "system-state:",
  "state:",
  "materialize from pin",
  "reconcile mission",
  "rescue:",
  "restore cache-clone",
  "cache-clone:",
];

export interface ExternalEditGuardInput {
  systemId: string;
  bordbuchEntries: Array<{
    kind?: string;
    metadata?: { commitSha?: string; preReconcileSha?: string };
  }>;
  gitLogShas: string[];
  gitLogSubjects?: string[];
  rangeShas: string[];
  // ADR-0091: optional baseline SHA from system-state.yaml — commits
  // at-or-older-than this SHA in rev-list order are grandfathered.
  externalEditBaselineSha?: string;
}

export interface ExternalEditGuardResult extends GuardResult {
  metadata?: {
    unexpectedCount?: number;
    firstUnexpectedSha?: string;
  };
}

export function evaluateExternalEditGate(input: ExternalEditGuardInput): ExternalEditGuardResult {
  const { systemId, bordbuchEntries, gitLogShas, rangeShas, externalEditBaselineSha } = input;

  // ADR-0091: positional grandfathering — git rev-list output is newest-first,
  // so the baseline SHA itself and every SHA after it (older commits) are
  // excluded from the check. A baseline that is absent from the rev-list must
  // never silently disable the guard — emit a distinct violation instead.
  let effectiveGitLogShas = gitLogShas;
  if (externalEditBaselineSha) {
    const baselineIndex = gitLogShas.indexOf(externalEditBaselineSha);
    if (baselineIndex === -1) {
      return {
        verdict: "fail",
        violations: [
          {
            rule: "external-edit-baseline-missing",
            systemId,
            message: `externalEditBaselineSha '${externalEditBaselineSha.slice(0, 12)}' is set in system-state.yaml but absent from git rev-list — fix the baseline SHA or remove the field (a wrong baseline must never disable the external-edit check unnoticed)`,
          },
        ],
        summary: `external-edit baseline SHA missing from git history for ${systemId}`,
      };
    }
    effectiveGitLogShas = gitLogShas.slice(0, baselineIndex);
  }

  const expectedShas = new Set<string>();
  for (const entry of bordbuchEntries) {
    if (entry.kind === "mission-reconcile" && entry.metadata?.commitSha) {
      expectedShas.add(entry.metadata.commitSha);
    }
  }
  for (const sha of rangeShas) {
    expectedShas.add(sha);
  }

  // Pipeline bookkeeping commits carry machine-authored subjects — whitelist
  // them so the guard only flags commits with foreign (human/tool) subjects.
  if (input.gitLogSubjects) {
    for (let i = 0; i < effectiveGitLogShas.length; i++) {
      const sha = gitLogShas.indexOf(effectiveGitLogShas[i]!);
      const subject = sha === -1 ? "" : (input.gitLogSubjects[sha] ?? "");
      if (PIPELINE_SUBJECT_PREFIXES.some((prefix) => subject.startsWith(prefix))) {
        expectedShas.add(effectiveGitLogShas[i]!);
      }
    }
  }

  const unexpectedShas = effectiveGitLogShas.filter((sha) => !expectedShas.has(sha));

  if (unexpectedShas.length === 0) {
    return {
      verdict: "pass",
      violations: [],
      summary: `No external edits detected for ${systemId}`,
    };
  }

  return {
    verdict: "fail",
    violations: [
      {
        rule: "external-edit-detected",
        systemId,
        message: `${unexpectedShas.length} commit(s) in git log not traced to any Bordbuch reconcile entry. External edits detected — consider demoting system to 'paused'. First unexpected SHA: ${unexpectedShas[0]!.slice(0, 12)}`,
      },
    ],
    summary: `${unexpectedShas.length} external edit(s) detected for ${systemId}`,
    metadata: {
      unexpectedCount: unexpectedShas.length,
      firstUnexpectedSha: unexpectedShas[0],
    },
  };
}
