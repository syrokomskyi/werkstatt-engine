/*
<MODULE_CONTRACT>
<purpose>external-edit-guard — pure external-edit guard extracted from the sternsystem.validate inline block (RFC-0520).</purpose>
<non-goals>
  <item>Does not read Bordbuch or run git rev-list — the caller gathers I/O and passes results.</item>
  <item>Does not fix the type vs kind field mismatch — pre-existing bug deferred to separate RFC.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0520: initial extraction of Bordbuch-vs-git-log guard as pure function.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { GuardResult } from "../handoff/guards.ts";

export interface ExternalEditGuardInput {
  systemId: string;
  bordbuchEntries: Array<{
    type?: string;
    metadata?: { commitSha?: string; preReconcileSha?: string };
  }>;
  gitLogShas: string[];
  rangeShas: string[];
}

export interface ExternalEditGuardResult extends GuardResult {
  metadata?: {
    unexpectedCount?: number;
    firstUnexpectedSha?: string;
  };
}

export function evaluateExternalEditGate(input: ExternalEditGuardInput): ExternalEditGuardResult {
  const { systemId, bordbuchEntries, gitLogShas, rangeShas } = input;

  const expectedShas = new Set<string>();
  for (const entry of bordbuchEntries) {
    if (entry.type === "mission-reconcile" && entry.metadata?.commitSha) {
      expectedShas.add(entry.metadata.commitSha);
    }
  }
  for (const sha of rangeShas) {
    expectedShas.add(sha);
  }

  const unexpectedShas = gitLogShas.filter((sha) => !expectedShas.has(sha));

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
