/*
<MODULE_CONTRACT>
  <purpose>Regenerate the RFC-1324 cold-run intake fixture bundles (intake.json + MANIFEST.sha256 + payloads) via buildIntakeBundle.</purpose>

  <non-goals>
    <item>Do not edit the emitted fixture files by hand — regenerate via this script so envelope and manifest hashes stay honest.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1324: initial — three-fixture intake matrix generator (valid-minimal, de-domain, latin-only).</item>
  <item>RFC-1324</item>
</CHANGE_SUMMARY>
*/
// Run: pnpm exec tsx gen-rfc1324-fixtures.ts (from packages/werkstatt-engine)
import { createHash } from "node:crypto";
import { buildIntakeBundle } from "./src/intake/test-bundle.ts";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

const { io } = createDefaultIO();
const root =
  "/home/syrokomskyi/projects/warpgogol/werkstatt/packages/werkstatt-engine/src/intake/fixtures";

type Pbp = Record<string, unknown>[];
type Envelope = Record<string, unknown> & {
  classification: Record<string, unknown>;
  pbp: Pbp;
};

const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// Extend pageSetIntent to the composed page set (home + about + contacts).
const pageSetIntent = [
  { intent: "home", evidenceRefs: ["evidence-source/src-01"] },
  { intent: "about", evidenceRefs: ["evidence-source/src-01"] },
  { intent: "contacts", evidenceRefs: ["evidence-source/src-01"] },
];

// Replace the shared Russian interview with a fixture-locale source doc so
// verbatim quotes (INTAKE-05 byte-exact substrings) stay honest.
function swapSource(seed: { files: Map<string, string>; envelope: Envelope }, text: string) {
  const sha = sha256Hex(text);
  for (const key of [...seed.files.keys()]) {
    if (key.startsWith("sources/")) seed.files.delete(key);
  }
  seed.files.set(`sources/${sha}.md`, text);
  const evidence = seed.envelope.pbp.find((e) => e.type === "evidence-source") as {
    items: { src: { sha256: string } };
  };
  evidence.items.src.sha256 = sha;
}

// ── valid-minimal: unchanged shape, intents now cover the composed pages ──
await buildIntakeBundle(`${root}/valid-minimal`, io, {
  mutate: (seed) => {
    const env = seed.envelope as Envelope;
    env.classification.pageSetIntent = pageSetIntent;
  },
});

// ── de-domain: de primary + en secondary, confirmed domain, DE jurisdiction ──
const DE_SOURCE_MD = `# Kundengespräch — 2026-10-10

Kunde: "Nachweisbare Qualität zum fairen Preis" — das ist unser Anspruch.

Keine Versprechungen ohne Quelle — jede Angabe auf der Website muss auf
einen belegten Fakt verweisen.
`;
await buildIntakeBundle(`${root}/de-domain`, io, {
  mutate: (seed) => {
    const env = seed.envelope as Envelope;
    env.systemId = "de-domain";
    swapSource(seed as { files: Map<string, string>; envelope: Envelope }, DE_SOURCE_MD);
    env.classification = {
      ...env.classification,
      locales: [
        { tag: "de", role: "primary", sourceLanguageBy: "client", reviewer: "studio" },
        { tag: "en", role: "secondary", sourceLanguageBy: "translation", reviewer: "unassigned" },
      ],
      jurisdiction: "DE",
      domain: "e2e-de-domain.warpgogol.com",
      pageSetIntent,
    };
    const [business, legalIdentity, _evidenceSource, claim, draftClaim] = env.pbp as {
      id: string;
      [k: string]: unknown;
    }[];
    business.id = "business/demowerk";
    business.name = "E2E Demowerk";
    business.legalIdentityRef = { ref: "pbp/legal-identity@1:legal-identity/demowerk" };
    legalIdentity.id = "legal-identity/demowerk";
    legalIdentity.legalName = "E2E Demowerk GmbH";
    claim.statement = "Nachweisbare Qualität zum fairen Preis";
    claim.statementLang = "de";
    claim.statementByLocale = { en: "Verifiable quality at a fair price" };
    claim.subject = { kind: "business", name: "E2E Demowerk" };
    claim.governance = { authorityRef: "pbp/business@1:business/demowerk" };
    draftClaim.subject = { kind: "business", name: "E2E Demowerk" };
    draftClaim.statement = "Ein Jahr Montagegarantie";
    draftClaim.statementLang = "de";
    draftClaim.governance = { authorityRef: "pbp/business@1:business/demowerk" };
    const annotations = env.annotations as Record<string, Record<string, unknown>>;
    annotations["claim/european-quality"] = {
      verbatim: [
        {
          text: "Nachweisbare Qualität zum fairen Preis",
          sourceRef: "evidence-source/src-01",
          speaker: "client",
        },
      ],
      ledgerRef: "CLM-023",
    };
    const voice = env.voice as {
      verbatim: { text: string; claimRefs?: string[] }[];
      directives: { text: string }[];
      profile: { linguisticRules: Record<string, string[]> };
    };
    voice.verbatim[0]!.text = "Nachweisbare Qualität zum fairen Preis";
    voice.directives[0]!.text = "Keine Versprechungen ohne Quelle";
    voice.profile.linguisticRules = {
      de: ["no anglicisms in headlines"],
      en: ["keep tone factual"],
    };
  },
});

// ── latin-only: en only, US jurisdiction, confirmed domain ──
const EN_SOURCE_MD = `# Client interview — 2026-10-10

Client: "Verifiable quality at a fair price" — that is our promise.

No claims without a source — every statement on the site must reference
a confirmed fact.
`;
await buildIntakeBundle(`${root}/latin-only`, io, {
  mutate: (seed) => {
    const env = seed.envelope as Envelope;
    env.systemId = "latin-only";
    swapSource(seed as { files: Map<string, string>; envelope: Envelope }, EN_SOURCE_MD);
    env.classification = {
      ...env.classification,
      locales: [{ tag: "en", role: "primary", sourceLanguageBy: "client", reviewer: "studio" }],
      jurisdiction: "US",
      domain: "e2e-latin-only.warpgogol.com",
      pageSetIntent,
    };
    const [business, legalIdentity, _evidenceSource, claim, draftClaim] = env.pbp as {
      id: string;
      [k: string]: unknown;
    }[];
    business.id = "business/latinworks";
    business.name = "E2E Latinworks";
    business.legalIdentityRef = { ref: "pbp/legal-identity@1:legal-identity/latinworks" };
    legalIdentity.id = "legal-identity/latinworks";
    legalIdentity.legalName = "E2E Latinworks LLC";
    claim.statement = "Verifiable quality at a fair price";
    claim.statementLang = "en";
    delete claim.statementByLocale;
    claim.subject = { kind: "business", name: "E2E Latinworks" };
    claim.governance = { authorityRef: "pbp/business@1:business/latinworks" };
    draftClaim.subject = { kind: "business", name: "E2E Latinworks" };
    draftClaim.statement = "One-year installation warranty";
    draftClaim.statementLang = "en";
    draftClaim.governance = { authorityRef: "pbp/business@1:business/latinworks" };
    const annotations = env.annotations as Record<string, Record<string, unknown>>;
    annotations["claim/european-quality"] = {
      verbatim: [
        {
          text: "Verifiable quality at a fair price",
          sourceRef: "evidence-source/src-01",
          speaker: "client",
        },
      ],
      ledgerRef: "CLM-023",
    };
    const voice = env.voice as {
      verbatim: { text: string }[];
      directives: { text: string }[];
      profile: { linguisticRules: Record<string, string[]> };
    };
    voice.verbatim[0]!.text = "Verifiable quality at a fair price";
    voice.directives[0]!.text = "No claims without a source";
    voice.profile.linguisticRules = { en: ["keep sentences short"] };
  },
});

console.log("fixtures regenerated");
