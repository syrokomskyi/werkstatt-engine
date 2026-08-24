/*
<MODULE_CONTRACT>
<purpose>
Small helpers shared between runtime/execute-command.ts and runtime/execute-pipeline.ts:
log-severity summarization for an execution report, and the option-object shape guard used
by both execute* entry points.
</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0303: split out of runtime.ts (Phase 3 file-size split, hot-path file 8/8).</item>
</CHANGE_SUMMARY>
*/

import type { KernelExecutionReport } from "../types.ts";

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
