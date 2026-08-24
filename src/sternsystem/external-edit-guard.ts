/*
<MODULE_CONTRACT>
<purpose>RFC-0520: pure external-edit guard extracted from sternsystem.validate inline block.</purpose>
<non-goals>
  <item>Does not read Bordbuch or run git rev-list — the caller gathers I/O and passes results.</item>
  <item>Does not fix the type vs kind field mismatch — pre-existing bug deferred to separate RFC.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0520: initial extraction of Bordbuch-vs-git-log guard as pure function.</item>
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
