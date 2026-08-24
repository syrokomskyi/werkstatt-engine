/*
<MODULE_CONTRACT>
<purpose>
  Sole runtime and type owner of DiagnosticSeverity, DiagnosticEvidence, and
  Diagnostic strict Zod schemas (RFC-0852). Types are inferred from schemas.
  kernel/types.ts re-exports these types; the site plugin imports the schemas.
</purpose>
<non-goals>
  <item>Do not define canonical JSON bytes or limits; RFC-0849 owns them.</item>
  <item>Do not define EvidenceEnvelopeV1, certification identities, or dossier admission; RFC-0853 owns those.</item>
  <item>Do not add command status vocabularies or suppression systems.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0852: Move canonical Diagnostic ownership from site plugin into the engine.</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";
import {
  isCanonicalJsonObjectV1,
  canonicalJsonBytesV1,
  type CanonicalJsonObjectV1,
} from "../fingerprint/canonical-json.ts";

// ---------------------------------------------------------------------------
// Limits (RFC-0852 §Bounds)
// ---------------------------------------------------------------------------

export const DIAGNOSTIC_LIMITS = {
  ruleIdChars: 128,
  messageBytes: 4 * 1024,
  fixHintBytes: 8 * 1024,
  pathBytes: 1024,
  urlBytes: 4 * 1024,
  snippetBytes: 16 * 1024,
  evidenceItems: 32,
  dataBytes: 64 * 1024,
  diagnosticBytes: 128 * 1024,
  diagnosticsPerResult: 1000,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

// ---------------------------------------------------------------------------
// Diagnostic rule ID — [A-Z0-9][A-Z0-9._-]* , max 128 ASCII chars
// ---------------------------------------------------------------------------

const diagnosticRuleIdPattern = /^[A-Z0-9][A-Z0-9._-]*$/;

export const diagnosticRuleIdSchema = z
  .string()
  .max(DIAGNOSTIC_LIMITS.ruleIdChars)
  .regex(
    diagnosticRuleIdPattern,
    "CERT-DIAGNOSTIC-SCHEMA-01: ruleId must match [A-Z0-9][A-Z0-9._-]*",
  );

// ---------------------------------------------------------------------------
// Safe workspace-relative POSIX path
// ---------------------------------------------------------------------------

const unsafePathPatterns = [
  /[/\\]\.\.([/\\]|$)/, // .. component
  /[/\\]\.([/\\]|$)/, // . component (but allow leading . for dotfiles? No — RFC says reject empty/.)
  /^\//, // absolute path
  /^[/\\]/, // leading separator
  /\\/, // backslash
  /\0/, // NUL
  /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, // URI scheme
  /^~([/\\]|$)/, // home expansion
  /^[a-zA-Z]:[\\/]/, // Windows drive letter
];

function isSafeWorkspaceRelativePath(value: string): boolean {
  if (value.length === 0) return false;
  if (utf8ByteLength(value) > DIAGNOSTIC_LIMITS.pathBytes) return false;
  for (const pattern of unsafePathPatterns) {
    if (pattern.test(value)) return false;
  }
  // Reject empty components from split
  const segments = value.split("/");
  for (const seg of segments) {
    if (seg.length === 0) return false; // empty component (e.g. "a//b")
    if (seg === "." || seg === "..") return false;
  }
  return true;
}

export const safeWorkspaceRelativePathSchema = z.string().refine(isSafeWorkspaceRelativePath, {
  message:
    "CERT-DIAGNOSTIC-LOCATOR-01: path must be a workspace-relative POSIX path without absolute paths, backslashes, empty/./.. components, NUL, URI schemes, or home expansion",
});

// ---------------------------------------------------------------------------
// Safe diagnostic URL — absolute http/https, no userinfo, no credentials
// ---------------------------------------------------------------------------

function isSafeDiagnosticUrl(value: string): boolean {
  if (utf8ByteLength(value) > DIAGNOSTIC_LIMITS.urlBytes) return false;
  if (/\0/.test(value)) return false;
  if (/[\x00-\x1f\x7f]/.test(value)) return false; // control characters

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  // Reject userinfo (credentials in authority)
  if (parsed.username || parsed.password) return false;

  // Reject credential-bearing query parameters (best-effort high-confidence)
  const query = parsed.searchParams;
  const credentialKeys = [
    "token",
    "access_token",
    "secret",
    "api_key",
    "apikey",
    "key",
    "password",
    "passwd",
    "pwd",
    "authorization",
    "auth",
    "signature",
    "sig",
  ];
  for (const key of credentialKeys) {
    if (query.has(key)) return false;
  }

  return true;
}

export const safeDiagnosticUrlSchema = z.string().refine(isSafeDiagnosticUrl, {
  message:
    "CERT-DIAGNOSTIC-LOCATOR-01: URL must be an absolute http/https URL with no userinfo, control characters, or credential-bearing query parameters",
});

// ---------------------------------------------------------------------------
// Redacted diagnostic text — no known secrets/PII/absolute paths
// ---------------------------------------------------------------------------

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/, // OpenAI-style API key
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/, // JWT
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/, // private key
  /Bearer\s+[A-Za-z0-9_-]{20,}/, // bearer token
  /Authorization:\s*Bearer\s+[A-Za-z0-9_-]{20,}/i, // auth header
  /(?:mongodb|postgres|postgresql|mysql|redis):\/\/[^\s@"']+:[^\s@"']+@/, // connection string
  /(?:aws_access_key_id|aws_secret_access_key)\s*=\s*[A-Za-z0-9/+=]{16,}/, // AWS creds
];

const absolutePathPatterns = [
  /^(?:\/|[A-Za-z]:[\\/]|~[\\/])/, // absolute or home path
];

const piiPatterns = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // email
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // phone (US-like)
];

function isRedactedDiagnosticText(value: string, maxBytes: number): boolean {
  if (utf8ByteLength(value) > maxBytes) return false;
  if (value.trim().length === 0) return false;

  for (const pattern of secretPatterns) {
    if (pattern.test(value)) return false;
  }
  for (const pattern of absolutePathPatterns) {
    if (pattern.test(value)) return false;
  }
  for (const pattern of piiPatterns) {
    if (pattern.test(value)) return false;
  }
  return true;
}

function redactedDiagnosticTextSchema(maxBytes: number) {
  return z.string().refine((val) => isRedactedDiagnosticText(val, maxBytes), {
    message: `CERT-DIAGNOSTIC-REDACTION-01: text must not contain known secrets, PII, or absolute paths and must be within ${maxBytes} UTF-8 bytes`,
  });
}

// ---------------------------------------------------------------------------
// Canonical JSON object V1 schema for Diagnostic.data
// ---------------------------------------------------------------------------
// RFC-0852: data must be a runtime-branded CanonicalJsonObjectV1 at parse time.
// The TypeScript type is Record<string, unknown> for structural compatibility
// with existing producers; the Zod custom check enforces canonical validation
// before persistence. z.custom is used instead of z.record because Zod 4's
// z.record structural validation rejects branded frozen objects created by
// snapshotCanonicalJsonObjectV1.

const canonicalJsonObjectV1Schema = z
  .custom<Record<string, unknown>>(
    (val): val is CanonicalJsonObjectV1 => isCanonicalJsonObjectV1(val),
    {
      message: "CERT-DIAGNOSTIC-SCHEMA-01: data must be a runtime-branded CanonicalJsonObjectV1",
    },
  )
  .refine(
    (val) => {
      if (!isCanonicalJsonObjectV1(val)) return false;
      const bytes = canonicalJsonBytesV1(val);
      return bytes.length <= DIAGNOSTIC_LIMITS.dataBytes;
    },
    {
      message: `CERT-DIAGNOSTIC-LIMIT-01: canonical data bytes must not exceed ${DIAGNOSTIC_LIMITS.dataBytes} bytes`,
    },
  );

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

export const diagnosticSeveritySchema = z.enum(["error", "warning", "info"]);
export type DiagnosticSeverity = z.infer<typeof diagnosticSeveritySchema>;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const diagnosticEvidenceSchema = z
  .object({
    kind: z.enum(["rule", "rendered", "source", "config", "cache", "runtime"]),
    ruleFile: safeWorkspaceRelativePathSchema.optional(),
    ruleId: diagnosticRuleIdSchema.optional(),
    file: safeWorkspaceRelativePathSchema.optional(),
    url: safeDiagnosticUrlSchema.optional(),
    snippet: redactedDiagnosticTextSchema(DIAGNOSTIC_LIMITS.snippetBytes).optional(),
  })
  .strict();

export type DiagnosticEvidence = z.infer<typeof diagnosticEvidenceSchema>;

// ---------------------------------------------------------------------------
// Diagnostic
// ---------------------------------------------------------------------------

export const diagnosticSchema = z
  .object({
    ruleId: diagnosticRuleIdSchema,
    severity: diagnosticSeveritySchema,
    message: redactedDiagnosticTextSchema(DIAGNOSTIC_LIMITS.messageBytes),
    file: safeWorkspaceRelativePathSchema.optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    fixHint: redactedDiagnosticTextSchema(DIAGNOSTIC_LIMITS.fixHintBytes).optional(),
    evidence: z.array(diagnosticEvidenceSchema).max(DIAGNOSTIC_LIMITS.evidenceItems).optional(),
    data: canonicalJsonObjectV1Schema.optional(),
  })
  .strict();

export type Diagnostic = z.infer<typeof diagnosticSchema>;
