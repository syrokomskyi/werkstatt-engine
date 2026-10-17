/*
<MODULE_CONTRACT>
<purpose>
RFC-1213 AC tests: the verifier boundary — a valid+bound presentation yields
a verified verdict on the result (AC-2); absent/invalid presentations reject
with presentation-required/presentation-invalid (AC-3); the journaled record
carries a presentation hash and no claim values (AC-5); a cryptographically
valid VP bound to a different agentId is presentation-invalid (AC-8); an
expired credential is presentation-invalid (AC-9).
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1213: initial test coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { executeAction } from "./action-pipeline.ts";
import type { PresentationVerifier } from "./presentation.ts";
import { buildAgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import type { PresentationJournalRecord } from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import type { AgentGatePorts } from "./ports.ts";

const MANIFEST = buildAgentSurfaceManifest({
  generatedAt: "2026-01-01T00:00:00.000Z",
  site: "test-site",
  baseUrl: "https://test.example",
  languages: { default: "en", supported: ["en"] },
});

const GATED: CapabilityRecord = {
  id: "contract.sign",
  version: 1,
  kind: "action",
  sideEffect: "write",
  title: { en: "Sign a contract" },
  description: { en: "Requires age proof." },
  input: {
    type: "object",
    additionalProperties: false,
    properties: { email: { type: "string" } },
  },
  output: {
    type: "object",
    additionalProperties: false,
    properties: { receiptId: { type: "string" } },
  },
  requires: {
    entitlements: ["agent.actions"],
    sections: [],
    verifiablePresentation: {
      accept: [
        {
          type: "AgeOver18Credential",
          claims: ["credentialSubject.ageOver"],
          issuers: ["did:web:issuer.example"],
        },
      ],
      purpose: "Prove the caller's principal is an adult",
      bindTo: "verified-agent",
    },
  },
  integration: { eventKind: "lead", source: "agent" },
  humanEquivalent: { sectionType: "send-message" },
  limits: { perMinutePerIp: 10, maxPayloadBytes: 10240 },
};

/** A structurally plausible VC DM 2.0 presentation for the fake verifier. */
const VP = {
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  type: ["VerifiablePresentation"],
  holder: "agent-42",
  verifiableCredential: [
    {
      type: ["VerifiableCredential", "AgeOver18Credential"],
      issuer: "did:web:issuer.example",
      credentialSubject: { ageOver: true, pii: "must-never-leak" },
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
    },
  ],
};

/** Fake verifier port — extracts facts as a real VC library would. */
const goodVerifier: PresentationVerifier = async (vp) => {
  const pres = vp as typeof VP;
  return {
    holder: pres.holder,
    credentials: pres.verifiableCredential.map((c) => ({
      types: c.type,
      issuer: c.issuer,
      subject: c.credentialSubject as Record<string, unknown>,
      validFrom: c.validFrom,
      validUntil: c.validUntil,
    })),
  };
};

function ports(opts: {
  journal?: PresentationJournalRecord[];
  verifier?: PresentationVerifier;
}): AgentGatePorts {
  return {
    knowledge: { read: async () => null },
    dispatch: {
      send: async (event) => ({
        receiptId: event.eventId,
        status: "accepted" as const,
        duplicate: false,
        submittedAt: "2026-01-01T00:00:00.000Z",
      }),
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    presentationVerifier: opts.verifier,
    presentationJournal: opts.journal ? (r) => opts.journal!.push(r) : undefined,
  };
}

function run(opts: {
  presentation?: unknown;
  verified?: string;
  journal?: PresentationJournalRecord[];
  verifier?: PresentationVerifier | null;
  capability?: CapabilityRecord;
}) {
  return executeAction({
    capability: opts.capability ?? GATED,
    manifest: MANIFEST,
    ports: ports({
      journal: opts.journal,
      verifier: opts.verifier === null ? undefined : (opts.verifier ?? goodVerifier),
    }),
    validatedValue: { email: "agent@example.com" },
    agentIdentity: opts.verified ? { verifiedAgentId: opts.verified } : {},
    presentation: opts.presentation,
  });
}

test("AC-2: a valid bound presentation dispatches and binds a verified verdict", async () => {
  const result = await run({ presentation: VP, verified: "agent-42" });
  expect(result.kind).toBe("receipt");
  expect(result.verdict).toMatchObject({
    verified: true,
    matchedRequirement: "AgeOver18Credential",
    subjectBinding: "agent-42",
    issuer: "did:web:issuer.example",
  });
});

test("AC-3: a missing presentation rejects with presentation-required", async () => {
  const result = await run({ verified: "agent-42" });
  expect(result.kind).toBe("problem");
  if (result.kind === "problem") expect(result.problem.code).toBe("presentation-required");
});

test("AC-3: anonymous callers can never satisfy the requirement", async () => {
  const result = await run({ presentation: VP });
  expect(result.kind).toBe("problem");
  if (result.kind === "problem") expect(result.problem.code).toBe("presentation-required");
});

test("AC-3: cryptographic failure rejects with presentation-invalid", async () => {
  const result = await run({
    presentation: VP,
    verified: "agent-42",
    verifier: async () => null,
  });
  expect(result.kind).toBe("problem");
  if (result.kind === "problem") expect(result.problem.code).toBe("presentation-invalid");
});

test("AC-5: the journaled record carries a presentation hash and no claim values", async () => {
  const journal: PresentationJournalRecord[] = [];
  await run({ presentation: VP, verified: "agent-42", journal });
  expect(journal).toHaveLength(1);
  const record = journal[0]!;
  expect(record.schema).toBe("gogol.presentation-verdict/1");
  expect(record.presentationHash).toMatch(/^sha256:/);
  expect(record.verified).toBe(true);
  // Schema-level guarantee: serialized record must not contain the PII payload.
  expect(JSON.stringify(record)).not.toContain("must-never-leak");
  expect(JSON.stringify(record)).not.toContain("ageOver");
});

test("AC-8: a valid presentation bound to a different agentId is presentation-invalid", async () => {
  const result = await run({ presentation: VP, verified: "agent-99" });
  expect(result.kind).toBe("problem");
  if (result.kind === "problem") expect(result.problem.code).toBe("presentation-invalid");
  expect(result.verdict?.failureReason).toContain("holder-binding");
});

test("AC-9: a credential outside its validity window is presentation-invalid", async () => {
  const expired = {
    ...VP,
    verifiableCredential: [
      { ...VP.verifiableCredential[0]!, validUntil: "2025-06-01T00:00:00.000Z" },
    ],
  };
  const result = await run({ presentation: expired, verified: "agent-42" });
  expect(result.kind).toBe("problem");
  if (result.kind === "problem") expect(result.problem.code).toBe("presentation-invalid");
});

test("issuer outside the allowlist is rejected", async () => {
  const wrongIssuer = {
    ...VP,
    verifiableCredential: [{ ...VP.verifiableCredential[0]!, issuer: "did:web:evil.example" }],
  };
  const result = await run({ presentation: wrongIssuer, verified: "agent-42" });
  expect(result.kind).toBe("problem");
  if (result.kind === "problem") expect(result.problem.code).toBe("presentation-invalid");
});

test("an unresolved @name issuer ref fails closed, never degrades to any-issuer", async () => {
  const unresolved: CapabilityRecord = {
    ...GATED,
    requires: {
      ...GATED.requires,
      verifiablePresentation: {
        ...GATED.requires.verifiablePresentation!,
        accept: [
          {
            type: "AgeOver18Credential",
            claims: ["credentialSubject.ageOver"],
            issuers: ["@eudi"], // unresolved — never equals a did:/https: issuer id
          },
        ],
      },
    },
  };
  const result = await run({ capability: unresolved, presentation: VP, verified: "agent-42" });
  expect(result.kind).toBe("problem");
  if (result.kind === "problem") expect(result.problem.code).toBe("presentation-invalid");
});

test("verifier port absent → fail closed with presentation-invalid", async () => {
  const result = await run({ presentation: VP, verified: "agent-42", verifier: null });
  expect(result.kind).toBe("problem");
  if (result.kind === "problem") expect(result.problem.code).toBe("presentation-invalid");
  expect(result.verdict?.failureReason).toContain("verifier-unavailable");
});

test("a capability without the requirement dispatches unmodified", async () => {
  const plain: CapabilityRecord = {
    ...GATED,
    id: "lead.submit",
    requires: { entitlements: ["agent.actions"], sections: [] },
  };
  const result = await run({ capability: plain });
  expect(result.kind).toBe("receipt");
  expect(result.verdict).toBeUndefined();
});
