/*
<MODULE_CONTRACT>
<purpose>
RFC-1213: the verifier boundary for verifiable presentations — the ONLY place
presentation bytes/objects are parsed inside the gate. A capability declaring
`requires.verifiablePresentation` makes the caller attach a W3C VC DM 2.0
verifiable presentation (OIDC4VP-shaped, carried as the
`X-Agent-Verifiable-Presentation` base64url header on HTTP and the
`gogol.dev/verifiablePresentation` params._meta key on MCP/A2A). The boundary
splits duties: an injected `presentationVerifier` port owns cryptographic
proof verification (a maintained VC/OIDC4VP library plugs in there — none is
bundled with v1 readiness), while THIS module owns policy — validity window,
issuer allowlist, holder binding to the verified agentId (replay protection),
and claim-path presence. Downstream code sees a `PresentationVerdict` only;
the journal records a hash, never presentation contents.
</purpose>
<non-goals>
  <item>Do not verify cryptographic proofs inline — that is the injected
        verifier port's job; this boundary trusts its verdict.</item>
  <item>Do not persist claim values — journal records carry
        {requirementId, verified, issuer, failureReason, presentationHash}
        only (AC-5, schema-enforced).</item>
  <item>Do not resolve "@name" issuer refs at runtime — serialized
        capabilities carry resolved inline issuers (generation resolves
        against trusted-issuers.yaml; AGP-05 gates the declaration).</item>
  <item>Do not check credentialStatus revocation — out of scope for v1
        (RFC-1213 nonGoal).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1213: initial verifier boundary — port-based proof verification + policy (window, issuers, verified-agent binding, claims) + hash-only journaling.</item>
</CHANGE_SUMMARY>
*/

import { byteHash } from "@warpgogol/werkstatt-shared/fingerprint";
import {
  buildAgentProblem,
  PRESENTATION_VERDICT_SCHEMA_ID,
  presentationJournalRecordSchema,
  type AgentProblemDetails,
  type PresentationAcceptEntry,
  type PresentationJournalRecord,
  type PresentationVerdict,
  type VerifiablePresentationRequirement,
} from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import type { AgentGatePorts } from "./ports.ts";

/** RFC-1213: HTTP transport — base64url-encoded JSON verifiable presentation. */
export const VP_HEADER = "x-agent-verifiable-presentation";
/** RFC-1213: MCP/A2A transport — params._meta key carrying the VP object. */
export const PRESENTATION_META_KEY = "gogol.dev/verifiablePresentation";

/**
 * Cryptography-facing facts the injected verifier extracts AFTER proof
 * verification succeeds. `holder` is the VP-level holder binding (for
 * bindTo "verified-agent" it must equal the calling verified agentId);
 * per-credential facts drive issuer/window/type/claim policy checks.
 */
export interface VerifiedPresentationFacts {
  holder?: string;
  credentials: Array<{
    types: string[];
    issuer?: string;
    /** The credential subject object — used for claim-path presence only. */
    subject?: Record<string, unknown>;
    validFrom?: string;
    validUntil?: string;
  }>;
}

/**
 * The injected cryptographic verification port. Implementations verify the
 * VP proof + embedded VC proofs and return extracted facts; null means the
 * cryptographic layer failed. Absent port = no verifier surface (AGP-02
 * blocks such declarations at author time; runtime fails closed).
 */
export type PresentationVerifier = (
  presentation: unknown,
) => Promise<VerifiedPresentationFacts | null>;

/** Extract the VP from an HTTP request — base64url JSON in the header. */
export function extractHttpPresentation(request: Request): unknown {
  const raw = request.headers.get(VP_HEADER);
  if (!raw) return undefined;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return { __malformedPresentation: true };
  }
}

/** Claim-path presence check — "credentialSubject.ageOver" walks the subject. */
function claimPathPresent(subject: Record<string, unknown> | undefined, path: string): boolean {
  if (!subject) return false;
  // Paths are "credentialSubject.<field>" — the subject object IS credentialSubject.
  const rel = path.startsWith("credentialSubject.")
    ? path.slice("credentialSubject.".length)
    : path;
  let cursor: unknown = subject;
  for (const seg of rel.split(".")) {
    if (typeof cursor !== "object" || cursor === null || !(seg in cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor !== undefined && cursor !== null;
}

function windowOk(
  validFrom: string | undefined,
  validUntil: string | undefined,
  now: Date,
): boolean {
  if (validFrom !== undefined) {
    const from = Date.parse(validFrom);
    if (!Number.isNaN(from) && now.getTime() < from) return false;
  }
  if (validUntil !== undefined) {
    const until = Date.parse(validUntil);
    if (!Number.isNaN(until) && now.getTime() > until) return false;
  }
  return true;
}

/** Emit the journaled verdict — hash only, fire-and-forget like usage/telemetry. */
function journalVerdict(
  ports: AgentGatePorts,
  input: {
    siteId: string;
    capabilityId: string;
    requirementId: string;
    presentation: unknown;
    verdict: PresentationVerdict;
  },
): void {
  try {
    if (!ports.presentationJournal) return;
    const record: PresentationJournalRecord = presentationJournalRecordSchema.parse({
      schema: PRESENTATION_VERDICT_SCHEMA_ID,
      siteId: input.siteId,
      capability: input.capabilityId,
      requirementId: input.requirementId,
      verified: input.verdict.verified,
      ...(input.verdict.issuer ? { issuer: input.verdict.issuer } : {}),
      ...(input.verdict.failureReason ? { failureReason: input.verdict.failureReason } : {}),
      presentationHash: byteHash(JSON.stringify(input.presentation)),
      occurredAt: ports.now().toISOString(),
    });
    ports.presentationJournal(record);
  } catch {
    // Silent drop — presentation journaling never breaks the request path.
  }
}

export interface PresentationCheckResult {
  verdict: PresentationVerdict;
  problem?: AgentProblemDetails;
}

/**
 * The requires-checks boundary: returns a verdict plus an RFC 9457 problem
 * when the requirement is unsatisfied. Anonymous callers on a requiring
 * capability are `presentation-required` (bindTo "verified-agent" is
 * unsatisfiable without verified identity — AUDIT-RFC-1213-01 replay guard).
 */
export async function checkPresentationRequirement(input: {
  ports: AgentGatePorts;
  siteId: string;
  capability: CapabilityRecord;
  presentation: unknown;
  verifiedAgentId?: string;
}): Promise<PresentationCheckResult> {
  const { ports, capability, presentation, verifiedAgentId } = input;
  const requirement: VerifiablePresentationRequirement | undefined =
    capability.requires.verifiablePresentation;
  if (!requirement) return { verdict: { verified: false } };

  const journal = (verdict: PresentationVerdict): PresentationCheckResult => {
    if (presentation !== undefined) {
      journalVerdict(ports, {
        siteId: input.siteId,
        capabilityId: capability.id,
        requirementId: requirement.accept.map((a) => a.type).join(","),
        presentation,
        verdict,
      });
    }
    return verdict.verified
      ? { verdict }
      : {
          verdict,
          problem: buildAgentProblem(
            verdict.failureReason?.startsWith("absent") ||
              verdict.failureReason?.startsWith("unauthenticated")
              ? "presentation-required"
              : "presentation-invalid",
            { detail: verdict.failureReason },
          ),
        };
  };

  if (!verifiedAgentId) {
    return journal({
      verified: false,
      failureReason:
        "unauthenticated: verifiablePresentation requires a verified agent identity (bindTo verified-agent)",
    });
  }
  if (presentation === undefined || presentation === null) {
    return journal({ verified: false, failureReason: "absent: no presentation attached" });
  }
  if (typeof presentation !== "object") {
    return journal({ verified: false, failureReason: "malformed: presentation is not an object" });
  }
  if (!ports.presentationVerifier) {
    return journal({
      verified: false,
      failureReason: "verifier-unavailable: no presentation verifier configured",
    });
  }

  let facts: VerifiedPresentationFacts | null;
  try {
    facts = await ports.presentationVerifier(presentation);
  } catch {
    facts = null;
  }
  if (!facts) {
    return journal({
      verified: false,
      failureReason: "crypto: presentation proofs did not verify",
    });
  }

  // Replay protection (AC-8): the VP holder binding MUST equal the calling
  // verified agentId — a cryptographically valid VP bound to somebody else
  // is a captured-token replay.
  if (facts.holder !== verifiedAgentId) {
    return journal({
      verified: false,
      failureReason: "holder-binding: presentation does not bind to the calling agent",
    });
  }

  const now = ports.now();
  for (const entry of requirement.accept) {
    const match = matchAcceptEntry(entry, facts, now);
    if (match) {
      return journal({
        verified: true,
        matchedRequirement: entry.type,
        subjectBinding: verifiedAgentId,
        issuer: match.issuer,
      });
    }
  }
  return journal({
    verified: false,
    failureReason: "no-accept-match: no credential satisfied the declared requirement",
  });
}

/** Find a credential satisfying one accept entry: type + claims + issuer + window. */
function matchAcceptEntry(
  entry: PresentationAcceptEntry,
  facts: VerifiedPresentationFacts,
  now: Date,
): { issuer?: string } | null {
  for (const cred of facts.credentials) {
    if (!cred.types.includes(entry.type)) continue;
    if (!(entry.claims ?? []).every((p) => claimPathPresent(cred.subject, p))) continue;
    // Serialized records carry resolved inline issuer ids. An unresolved
    // "@name" ref that survived to runtime stays in the allowlist as a
    // literal — it can never equal a real did:/https: issuer id, so the
    // entry fails closed instead of degrading to "any issuer".
    const allowed = entry.issuers ?? [];
    if (allowed.length > 0 && (cred.issuer === undefined || !allowed.includes(cred.issuer)))
      continue;
    if (!windowOk(cred.validFrom, cred.validUntil, now)) continue;
    return { issuer: cred.issuer };
  }
  return null;
}

/** Production journal sink — structured JSON line, drained like usage records. */
export function workerLogPresentationVerdict(record: PresentationJournalRecord): void {
  console.log(JSON.stringify(record));
}
