/*
<MODULE_CONTRACT>
<purpose>RFC-0852: Core strict/bounds/locator/redaction/canonical-data fixtures for the engine-owned Diagnostic schema.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0852: initial test suite covering positive, negative, boundary, locator, redaction, and canonical-data cases.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import {
  diagnosticSchema,
  diagnosticSeveritySchema,
  diagnosticEvidenceSchema,
  diagnosticRuleIdSchema,
  safeWorkspaceRelativePathSchema,
  safeDiagnosticUrlSchema,
  DIAGNOSTIC_LIMITS,
} from "../schemas/diagnostic.ts";
import { snapshotCanonicalJsonObjectV1 } from "../fingerprint/canonical-json.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidDiagnostic() {
  return {
    ruleId: "CW-TECH-01",
    severity: "error" as const,
    message: "Page has no document title.",
  };
}

function makeCanonicalData(obj: Record<string, unknown>) {
  const result = snapshotCanonicalJsonObjectV1(obj);
  if (!result.ok) {
    throw new Error(`snapshot failed: ${result.code} — ${result.message}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

test("diagnosticSeveritySchema accepts all three severities", () => {
  for (const sev of ["error", "warning", "info"] as const) {
    expect(diagnosticSeveritySchema.safeParse(sev).success).toBe(true);
  }
});

test("diagnosticSeveritySchema rejects unknown severity", () => {
  expect(diagnosticSeveritySchema.safeParse("warn").success).toBe(false);
  expect(diagnosticSeveritySchema.safeParse("critical").success).toBe(false);
  expect(diagnosticSeveritySchema.safeParse(42).success).toBe(false);
});

// ---------------------------------------------------------------------------
// Rule ID
// ---------------------------------------------------------------------------

test("diagnosticRuleIdSchema accepts valid rule IDs", () => {
  expect(diagnosticRuleIdSchema.safeParse("CW-TECH-01").success).toBe(true);
  expect(diagnosticRuleIdSchema.safeParse("A").success).toBe(true);
  expect(diagnosticRuleIdSchema.safeParse("AUDIT.LLM.MISSING").success).toBe(true);
});

test("diagnosticRuleIdSchema rejects lowercase", () => {
  expect(diagnosticRuleIdSchema.safeParse("cw-tech-01").success).toBe(false);
});

test("diagnosticRuleIdSchema rejects empty", () => {
  expect(diagnosticRuleIdSchema.safeParse("").success).toBe(false);
});

test("diagnosticRuleIdSchema rejects IDs exceeding 128 chars", () => {
  const long = "A".repeat(129);
  expect(diagnosticRuleIdSchema.safeParse(long).success).toBe(false);
});

test("diagnosticRuleIdSchema accepts exactly 128 chars", () => {
  const max = "A".repeat(128);
  expect(diagnosticRuleIdSchema.safeParse(max).success).toBe(true);
});

// ---------------------------------------------------------------------------
// Safe workspace-relative path
// ---------------------------------------------------------------------------

test("safeWorkspaceRelativePathSchema accepts valid relative paths", () => {
  expect(safeWorkspaceRelativePathSchema.safeParse("src/content/page.md").success).toBe(true);
  expect(
    safeWorkspaceRelativePathSchema.safeParse("packages/werkstatt-site/src/index.ts").success,
  ).toBe(true);
});

test("safeWorkspaceRelativePathSchema rejects absolute paths", () => {
  expect(safeWorkspaceRelativePathSchema.safeParse("/etc/passwd").success).toBe(false);
  expect(safeWorkspaceRelativePathSchema.safeParse("/home/user/file").success).toBe(false);
});

test("safeWorkspaceRelativePathSchema rejects backslashes", () => {
  expect(safeWorkspaceRelativePathSchema.safeParse("src\\file.ts").success).toBe(false);
});

test("safeWorkspaceRelativePathSchema rejects .. components", () => {
  expect(safeWorkspaceRelativePathSchema.safeParse("../secret").success).toBe(false);
  expect(safeWorkspaceRelativePathSchema.safeParse("src/../secret").success).toBe(false);
});

test("safeWorkspaceRelativePathSchema rejects empty components", () => {
  expect(safeWorkspaceRelativePathSchema.safeParse("src//file.ts").success).toBe(false);
});

test("safeWorkspaceRelativePathSchema rejects URI schemes", () => {
  expect(safeWorkspaceRelativePathSchema.safeParse("file:///etc/passwd").success).toBe(false);
  expect(safeWorkspaceRelativePathSchema.safeParse("http://example.com").success).toBe(false);
});

test("safeWorkspaceRelativePathSchema rejects home expansion", () => {
  expect(safeWorkspaceRelativePathSchema.safeParse("~/secret").success).toBe(false);
});

test("safeWorkspaceRelativePathSchema rejects Windows drive letters", () => {
  expect(safeWorkspaceRelativePathSchema.safeParse("C:\\file.ts").success).toBe(false);
});

// ---------------------------------------------------------------------------
// Safe diagnostic URL
// ---------------------------------------------------------------------------

test("safeDiagnosticUrlSchema accepts http and https URLs", () => {
  expect(safeDiagnosticUrlSchema.safeParse("http://example.com").success).toBe(true);
  expect(safeDiagnosticUrlSchema.safeParse("https://example.com/page").success).toBe(true);
});

test("safeDiagnosticUrlSchema rejects non-http protocols", () => {
  expect(safeDiagnosticUrlSchema.safeParse("ftp://example.com").success).toBe(false);
  expect(safeDiagnosticUrlSchema.safeParse("file:///etc/passwd").success).toBe(false);
});

test("safeDiagnosticUrlSchema rejects userinfo", () => {
  expect(safeDiagnosticUrlSchema.safeParse("https://user:pass@example.com").success).toBe(false);
});

test("safeDiagnosticUrlSchema rejects credential-bearing query params", () => {
  expect(safeDiagnosticUrlSchema.safeParse("https://example.com?token=secret").success).toBe(false);
  expect(safeDiagnosticUrlSchema.safeParse("https://example.com?api_key=secret").success).toBe(
    false,
  );
  expect(safeDiagnosticUrlSchema.safeParse("https://example.com?key=secret").success).toBe(false);
});

test("safeDiagnosticUrlSchema rejects control characters", () => {
  expect(safeDiagnosticUrlSchema.safeParse("https://example.com\x00").success).toBe(false);
});

// ---------------------------------------------------------------------------
// Diagnostic — positive
// ---------------------------------------------------------------------------

test("diagnosticSchema accepts minimal valid diagnostic", () => {
  const result = diagnosticSchema.safeParse(makeValidDiagnostic());
  expect(result.success).toBe(true);
});

test("diagnosticSchema accepts full valid diagnostic", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    file: "src/content/page.md",
    line: 42,
    column: 10,
    fixHint: "Add a localized title element.",
    evidence: [
      {
        kind: "rule" as const,
        ruleFile: "packages/werkstatt-site/src/checks/audit/rules.yaml",
        ruleId: "CW-TECH-01",
      },
      {
        kind: "rendered" as const,
        file: "dist/page.html",
        url: "https://example.com/page",
        snippet: "<title>Missing</title>",
      },
    ],
    data: makeCanonicalData({ url: "https://example.com/page", sectionId: "intro" }),
  });
  expect(result.success).toBe(true);
});

// ---------------------------------------------------------------------------
// Diagnostic — negative (legacy fields)
// ---------------------------------------------------------------------------

test("diagnosticSchema rejects id field (legacy)", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    id: "f-001",
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects blockId field (legacy)", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    blockId: "hero-section",
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects suggestion field (legacy)", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    suggestion: "Fix the title",
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects unknown fields (strict)", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    customField: "value",
  });
  expect(result.success).toBe(false);
});

// ---------------------------------------------------------------------------
// Diagnostic — bounds
// ---------------------------------------------------------------------------

test("diagnosticSchema rejects empty message", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    message: "",
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects whitespace-only message", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    message: "   ",
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects message exceeding 4 KiB", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    message: "A".repeat(DIAGNOSTIC_LIMITS.messageBytes + 1),
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects fixHint exceeding 8 KiB", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    fixHint: "A".repeat(DIAGNOSTIC_LIMITS.fixHintBytes + 1),
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects more than 32 evidence items", () => {
  const evidence = Array.from({ length: DIAGNOSTIC_LIMITS.evidenceItems + 1 }, () => ({
    kind: "rule" as const,
  }));
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    evidence,
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema accepts exactly 32 evidence items", () => {
  const evidence = Array.from({ length: DIAGNOSTIC_LIMITS.evidenceItems }, () => ({
    kind: "rule" as const,
  }));
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    evidence,
  });
  expect(result.success).toBe(true);
});

// ---------------------------------------------------------------------------
// Diagnostic — redaction
// ---------------------------------------------------------------------------

test("diagnosticSchema rejects message with API key pattern", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    message: "Found sk-abcdefghijklmnopqrstuvwxyz1234567890 in config",
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects message with JWT pattern", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    message: "Token: eyJabcdefghijklmnopqrstuvwxyz1234567890.abc",
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects message with private key", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    message: "-----BEGIN RSA PRIVATE KEY-----",
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects message with email (PII)", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    message: "Contact admin@example.com for details",
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects message with absolute path", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    message: "/home/user/secret was found in config",
  });
  expect(result.success).toBe(false);
});

// ---------------------------------------------------------------------------
// Diagnostic — data field (canonical JSON)
// ---------------------------------------------------------------------------

test("diagnosticSchema accepts data with canonical snapshot", () => {
  const data = makeCanonicalData({ url: "https://example.com" });
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    data,
  });
  expect(result.success).toBe(true);
});

test("diagnosticSchema rejects plain object data (not canonical-branded)", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    data: { url: "https://example.com" },
  });
  expect(result.success).toBe(false);
});

test("diagnosticSchema rejects null data", () => {
  const result = diagnosticSchema.safeParse({
    ...makeValidDiagnostic(),
    data: null,
  });
  expect(result.success).toBe(false);
});

// ---------------------------------------------------------------------------
// Evidence schema
// ---------------------------------------------------------------------------

test("diagnosticEvidenceSchema accepts valid evidence", () => {
  const result = diagnosticEvidenceSchema.safeParse({
    kind: "rule",
    ruleFile: "packages/werkstatt-site/src/checks/audit/rules.yaml",
    ruleId: "CW-TECH-01",
  });
  expect(result.success).toBe(true);
});

test("diagnosticEvidenceSchema rejects unknown kind", () => {
  const result = diagnosticEvidenceSchema.safeParse({
    kind: "custom",
  });
  expect(result.success).toBe(false);
});

test("diagnosticEvidenceSchema rejects unknown fields (strict)", () => {
  const result = diagnosticEvidenceSchema.safeParse({
    kind: "rule",
    customField: "value",
  });
  expect(result.success).toBe(false);
});

test("diagnosticEvidenceSchema rejects snippet with secret", () => {
  const result = diagnosticEvidenceSchema.safeParse({
    kind: "runtime",
    snippet: "sk-abcdefghijklmnopqrstuvwxyz1234567890",
  });
  expect(result.success).toBe(false);
});
