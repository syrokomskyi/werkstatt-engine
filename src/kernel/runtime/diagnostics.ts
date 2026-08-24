/*
<MODULE_CONTRACT>
<purpose>
RFC-0086 text-mode diagnostic printing: format a failing command's data payload (canonical
RFC-0203 Diagnostic array, or the legacy violations/findings/details shapes) into indented
console-ready body lines, deterministically ordered.
</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0303: split out of runtime.ts (Phase 3 file-size split, hot-path file 8/8).</item>
</CHANGE_SUMMARY>
*/

const DIAGNOSTIC_LINE_CAP = 50;

/**
 * RFC-0086: inspect a failing command's `data` payload for actionable items
 * and return a list of indented body strings ready to feed through
 * `logger.error()`. The logger prefixes each line with `[ERROR] `, so the
 * returned strings start with 2 spaces to produce the documented
 * `[ERROR]   <rule> · <file> · <message>` shape.
 *
 * Precedence (first match wins, never concatenated):
 *   1. data.diagnostics: string[] | object[]   — plain text or {message, …}
 *   2. data.violations:  string[] | object[]   — {ruleId/rule, file, message}
 *   3. data.findings:    object[]              — RFC-0074 audit findings
 *   4. data.errors:      string[] | object[]   — generic error strings or {message, …}
 *   5. data.details:     object[]              — generic {file, message}
 *
 * Returns an empty array when no array matches. Caps the printable body at
 * 50 lines and appends `  … and N more (run with --json for the full list)`
 * when truncated.
 */
export function formatFailureDiagnostics(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const arrays: Array<{ key: string; value: unknown }> = [
    { key: "diagnostics", value: record.diagnostics },
    { key: "violations", value: record.violations },
    { key: "findings", value: record.findings },
    { key: "errors", value: record.errors },
    { key: "details", value: record.details },
  ];
  const source = arrays.find((entry) => Array.isArray(entry.value));
  if (!source) return [];
  const items = source.value as unknown[];
  if (items.length === 0) return [];

  // RFC-0203: deterministic ordering for canonical Diagnostic items so console
  // output is stable run-to-run (severity → file → line → ruleId). String items
  // (the resultFromViolations shim) keep their authored order.
  const ordered = items.every((item) => item !== null && typeof item === "object")
    ? [...items].sort(compareDiagnostics)
    : items;

  const limit = Math.min(ordered.length, DIAGNOSTIC_LINE_CAP);
  const lines: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const body = formatDiagnosticItem(ordered[index]);
    for (const segment of body.split(/\r?\n/)) {
      lines.push(`  ${segment}`);
    }
  }
  if (ordered.length > DIAGNOSTIC_LINE_CAP) {
    const remainder = ordered.length - DIAGNOSTIC_LINE_CAP;
    lines.push(`  … and ${remainder} more (run with --json for the full list)`);
  }
  return lines;
}

const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

function diagnosticTarget(record: Record<string, unknown>): string {
  return (
    asNonEmptyString(record.file) ??
    asNonEmptyString(record.path) ??
    asNonEmptyString(record.target) ??
    ""
  );
}

/** Stable comparator for canonical Diagnostic-shaped records (RFC-0203). */
function compareDiagnostics(a: unknown, b: unknown): number {
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const sevA = SEVERITY_RANK[String(ra.severity)] ?? 3;
  const sevB = SEVERITY_RANK[String(rb.severity)] ?? 3;
  if (sevA !== sevB) return sevA - sevB;
  const fileA = diagnosticTarget(ra);
  const fileB = diagnosticTarget(rb);
  if (fileA !== fileB) return fileA < fileB ? -1 : 1;
  const lineA = typeof ra.line === "number" ? ra.line : 0;
  const lineB = typeof rb.line === "number" ? rb.line : 0;
  if (lineA !== lineB) return lineA - lineB;
  const ruleA = asNonEmptyString(ra.ruleId) ?? asNonEmptyString(ra.rule) ?? "";
  const ruleB = asNonEmptyString(rb.ruleId) ?? asNonEmptyString(rb.rule) ?? "";
  return ruleA < ruleB ? -1 : ruleA > ruleB ? 1 : 0;
}

function formatDiagnosticItem(item: unknown): string {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return JSON.stringify(item);
  const record = item as Record<string, unknown>;
  const parts: string[] = [];
  const ruleOrSeverity =
    asNonEmptyString(record.ruleId) ??
    asNonEmptyString(record.rule) ??
    asNonEmptyString(record.severity);
  if (ruleOrSeverity) parts.push(ruleOrSeverity);
  // RFC-0203: locator in the canonical file:line:column form so editors and
  // agents can jump straight to the violation.
  const target =
    asNonEmptyString(record.file) ??
    asNonEmptyString(record.path) ??
    asNonEmptyString(record.target);
  if (target) {
    let locator = target;
    if (typeof record.line === "number") {
      locator += `:${record.line}`;
      if (typeof record.column === "number") locator += `:${record.column}`;
    }
    parts.push(locator);
  }
  const message = asNonEmptyString(record.message);
  if (message) parts.push(message);
  const head = parts.length > 0 ? parts.join(" · ") : JSON.stringify(item);
  // RFC-0203: surface the remediation on its own line so an agent reading the
  // console knows not just what is wrong but how to fix it.
  const fix = asNonEmptyString(record.fixHint) ?? asNonEmptyString(record.suggestion);
  return fix ? `${head}\nfix: ${fix}` : head;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
