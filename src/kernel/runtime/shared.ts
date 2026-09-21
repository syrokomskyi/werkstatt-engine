/*
<MODULE_CONTRACT>
<purpose>
Small helpers shared between runtime/execute-command.ts and runtime/execute-pipeline.ts:
log-severity summarization for an execution report, the option-object shape guard used
by both execute* entry points, and the skipped-execution report builder.
</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Shared helpers stay pure — no I/O, no state, just transformations.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>ADR-0087: add skippedExecutionReport — shared zero-duration Skipped-report builder used by the pipeline step loop and the executor-level closed-workpiece guard.</item>
  <item>RFC-0303: split out of runtime.ts (Phase 3 file-size split, hot-path file 8/8).</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandDefinition,
  KernelExecutionReport,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";

export function summarizeLogs(
  logs: KernelExecutionReport["logs"],
): KernelExecutionReport["logSummary"] {
  return {
    error: logs.filter((event) => event.severity === "error" || event.level === "error").length,
    warning: logs.filter((event) => event.severity === "warning" || event.level === "warn").length,
    notice: logs.filter((event) => event.severity === "notice").length,
    expectedFallback: logs.filter((event) => event.kind === "expected-fallback").length,
    suppressedDebug: logs.filter((event) => event.severity === "debug").length,
  };
}

// ---------------------------------------------------------------------------
// RFC-0260: strict shape validation for the execute* options objects.
// ---------------------------------------------------------------------------
// Regression guard for commit 8b3e62ab, where `args:` was passed instead of
// `argv:` and an `as any` cast let it through silently. These options objects
// are internal call-site contracts (not user CLI input), so a first-party
// Levenshtein nearest-key hint is enough — no schema library needed.

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i]![0] = i;
  for (let j = 0; j < cols; j += 1) dp[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[rows - 1]![cols - 1]!;
}

function nearestKeyHint(key: string, allowedKeys: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of allowedKeys) {
    const distance = levenshteinDistance(key, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= 3 ? best : undefined;
}

export function assertKnownOptionKeys(options: object, allowedKeys: string[], label: string): void {
  const unknown = Object.keys(options).filter((key) => !allowedKeys.includes(key));
  if (unknown.length === 0) return;
  const described = unknown.map((key) => {
    const hint = nearestKeyHint(key, allowedKeys);
    return hint ? `"${key}" (did you mean "${hint}"?)` : `"${key}"`;
  });
  throw new Error(
    `${label} received unknown key(s): ${described.join(", ")}. Valid keys: ${allowedKeys.join(", ")}.`,
  );
}

/**
 * Build a zero-duration `Skipped: <reason>` report for a command that was not
 * executed. Shared by the pipeline step loop (transitive-cache / closed-mission
 * skips) and the executor-level closed-workpiece guard (ADR-0087).
 */
export function skippedExecutionReport(
  command: KernelCommandDefinition,
  context: KernelRuntimeContext,
  reason?: string,
): KernelExecutionReport {
  return {
    siteName: context.site?.name,
    commandName: command.name,
    exitCode: 0,
    ok: true,
    summary: `Skipped: ${reason ?? "pipeline step marked skip"}`,
    metadata: command,
    logs: context.logger.getEvents(),
    logSummary: summarizeLogs(context.logger.getEvents()),
    timing: {
      durationMs: 0,
      exceededTimeout: false,
    },
    filesModified: [],
  };
}
