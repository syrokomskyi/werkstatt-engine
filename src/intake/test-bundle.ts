/*
<MODULE_CONTRACT>

<purpose>RFC-1281: buildIntakeBundle — materialize a complete, valid
werkstatt:intake/v1 hand-over bundle through WorkspaceIO for tests and the
committed fixtures/valid-minimal directory. Hashes are computed (not
hard-coded): file shas land in pbp evidence items, asset file/sha256,
evidence-ledger hash, provenance.contractSnapshot and MANIFEST.sha256.</purpose>
<non-goals>
  <item>Do not ship production logic — this is a test fixture builder only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1281: created — buildIntakeBundle fixture builder with mutate/manifestTransform hooks.</item>
  <item>RFC-1281: intake contract and onboarding.intake.validate</item>
</CHANGE_SUMMARY>
*/

import { createHash } from "node:crypto";
import { join } from "node:path";

import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

import { resolveIntakeExportSha256 } from "./intake-validate.ts";

/** Sentinel replaced after `mutate` — lets tests inject their own bad values. */
const AUTO = "__AUTO__";

export interface IntakeBundleSeed {
  /** intake.json object — contractSnapshot/evidenceLedger carry AUTO sentinels. */
  envelope: Record<string, unknown>;
  /** Bundle-relative files except intake.json + MANIFEST.sha256. */
  files: Map<string, string>;
}

export interface BuildIntakeBundleOptions {
  /** sha256:<hex> to stamp into provenance.contractSnapshot; defaults to the real export. */
  exportSha256?: string;
  /** Mutation point before hashing+manifest — break exactly one rule per test. */
  mutate?: (seed: IntakeBundleSeed) => void;
  /** Post-hash hook on the MANIFEST.sha256 text (INTAKE-01 tampering). */
  manifestTransform?: (manifest: string) => string;
}

export interface BuiltIntakeBundle {
  dir: string;
  /** sha256 of sources/<sha>.md + assets/<sha>.svg (bare hex). */
  sourceSha256: string;
  assetSha256: string;
  ledgerSha256: string;
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const SOURCE_MD = `# Client interview — 2026-10-10

Client: "Европейское качество — доступное каждому" — это наш слоган.

Никаких обещаний без источника — каждое утверждение на сайте должно
ссылаться на подтверждённый факт.
`;

const ASSET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1a3a5c"/><text x="8" y="40" fill="#fff" font-size="32">D7</text></svg>\n`;

function defaultEnvelope(sourceSha: string, assetSha: string): Record<string, unknown> {
  return {
    schema: "werkstatt:intake/v1",
    intakeId: "int_019a4f2c-7a01-7f30-8c1e-9f2e4a6b8d01",
    systemId: "dp7",
    producedAt: "2026-10-15T10:00:00Z",
    classification: {
      locales: [
        { tag: "ru", role: "primary", sourceLanguageBy: "client", reviewer: "studio" },
        {
          tag: "uz-Latn",
          role: "secondary",
          sourceLanguageBy: "translation",
          reviewer: "unassigned",
        },
      ],
      jurisdiction: "DE",
      conversionModel: "inquiry",
      profile: "standard",
      pageSetIntent: [{ intent: "home", evidenceRefs: ["evidence-source/src-01"] }],
    },
    pbp: [
      {
        schema: "pbp/business@1",
        id: "business/dp7",
        type: "business",
        status: "published",
        name: "DP7",
        legalIdentityRef: { ref: "pbp/legal-identity@1:legal-identity/dp7" },
      },
      {
        schema: "pbp/legal-identity@1",
        id: "legal-identity/dp7",
        type: "legal-identity",
        status: "published",
        legalName: "DP7 Digitalprojekt GmbH",
      },
      {
        schema: "pbp/evidence-source@1",
        id: "evidence-source/src-01",
        type: "evidence-source",
        status: "published",
        name: "Client interview 2026-10-10",
        kind: "client-statement",
        authority: { kind: "client" },
        slug: "client-interview-2026-10-10",
        display: {
          document: "visible",
          screenshot: "hidden",
          websiteLink: "hidden",
        },
        items: {
          src: {
            sha256: sourceSha,
            mediaType: "text/markdown",
            storage: "private",
          },
        },
      },
      {
        schema: "pbp/claim@1",
        id: "claim/european-quality",
        type: "claim",
        status: "published",
        claimClass: "factual",
        claimKind: "fact",
        subject: { kind: "business", name: "DP7" },
        statement: "Европейское качество — доступное каждому",
        statementLang: "ru",
        evidenceRefs: {
          src: { ref: "pbp/evidence-source@1:evidence-source/src-01" },
        },
        governance: { authorityRef: "pbp/business@1:business/dp7" },
      },
      {
        schema: "pbp/claim@1",
        id: "claim/installation-warranty",
        type: "claim",
        status: "draft",
        claimClass: "factual",
        claimKind: "fact",
        subject: { kind: "business", name: "DP7" },
        statement: "One-year installation warranty",
        statementLang: "ru",
        governance: { authorityRef: "pbp/business@1:business/dp7" },
      },
    ],
    annotations: {
      "claim/european-quality": {
        verbatim: [
          {
            text: "Европейское качество — доступное каждому",
            sourceRef: "evidence-source/src-01",
            speaker: "client",
          },
        ],
        ledgerRef: "CLM-023",
      },
      "claim/installation-warranty": { gapRef: "GAP-04" },
    },
    gaps: [
      {
        id: "GAP-04",
        what: "Warranty policy wording",
        why: "A publishable warranty claim requires the client's actual terms",
        obtainableBy: "client",
        itemType: "file",
        clientPrompt: "Upload your warranty terms document",
        defaultIfSilent: "One-year installation warranty",
        blocks: ["claim/installation-warranty"],
        severity: "launch-blocking",
      },
    ],
    operatorDecisions: [
      {
        id: "OPD-01",
        kind: "ruling",
        gate: "G-V",
        question: "Accept concept-1 as the visual direction?",
        answer: "yes",
        answeredAt: "2026-10-15T10:00:00Z",
        reversible: false,
      },
    ],
    voice: {
      verbatim: [
        {
          id: "VOI-01",
          text: "Европейское качество — доступное каждому",
          sourceRef: "evidence-source/src-01",
          use: "slogan",
          claimRefs: ["claim/european-quality"],
        },
      ],
      directives: [
        {
          id: "DIR-01",
          text: "Никаких обещаний без источника",
          sourceRef: "evidence-source/src-01",
          appliesTo: ["composition", "publication"],
        },
      ],
      profile: {
        toneOfVoice: {
          tone: "calm",
          posture: "expert",
          readingLevel: "B2",
          avoids: ["hype", "superlatives without proof"],
          prefers: ["concrete numbers", "short sentences"],
        },
        linguisticRules: {
          ru: ["no anglicisms in headlines"],
          "uz-Latn": ["keep loanword spellings consistent"],
        },
        culturalRules: ["respect local forms of address"],
      },
    },
    visual: {
      conceptId: "concept-1",
      rejectedConceptIds: ["concept-2"],
      axes: {
        warmth: "neutral",
        contrast: "medium",
        density: "comfortable",
        typographySharpness: "balanced",
        diagramPresence: "minimal",
        photoStance: "documentary",
        motionStance: "restrained",
        textContrast: "aa",
        cornerRadius: "4px",
        borderWeight: "1px",
      },
      palette: { brand: "#1a3a5c", ink: "#111111", paper: "#f7f5f0" },
      fonts: [
        {
          family: "Inter",
          role: "body",
          source: "@fontsource/inter",
          scripts: ["Latn", "Cyrl"],
        },
      ],
      moodAssetRefs: ["AST-01"],
      rationale: "quiet factual authority",
    },
    assets: [
      {
        id: "AST-01",
        kind: "logo",
        file: `assets/${assetSha}.svg`,
        sha256: `sha256:${assetSha}`,
        mediaType: "image/svg+xml",
        origin: "generated",
        rights: { state: "generated" },
        generator: {
          model: "flux-1-pro",
          promptSha256: `sha256:${"c".repeat(64)}`,
          conceptId: "concept-1",
          generatedAt: "2026-10-15T09:00:00Z",
        },
      },
    ],
    provenance: {
      producer: "site-werkstatt",
      producerVersion: "0.1.0",
      runId: "run-2026-10-15-01",
      contractSnapshot: AUTO,
      inputs: [
        {
          path: ".input/client-knowledge-base.json",
          sha256: `sha256:${"d".repeat(64)}`,
          bytes: 42137,
        },
      ],
      evidenceLedger: AUTO,
      models: [{ step: "phase0-ledger", model: "claude-opus-4.1", effort: "high" }],
      quoteCheck: { result: "pass", checked: 3, failed: 0 },
      cost: { currency: "USD", total: 4.2, reportPath: "cost-report.json" },
    },
  };
}

/**
 * Materialize a valid intake bundle at `dir` (created recursively by writes).
 * `mutate` runs before hashing so mutations stay hash-consistent; INTAKE-01
 * tampering uses `manifestTransform` instead.
 */
export async function buildIntakeBundle(
  dir: string,
  io: WorkspaceIO,
  options: BuildIntakeBundleOptions = {},
): Promise<BuiltIntakeBundle> {
  const sourceSha = sha256Hex(new TextEncoder().encode(SOURCE_MD));
  const assetSha = sha256Hex(new TextEncoder().encode(ASSET_SVG));

  const files = new Map<string, string>();
  files.set(`sources/${sourceSha}.md`, SOURCE_MD);
  files.set(`assets/${assetSha}.svg`, ASSET_SVG);
  files.set(
    "evidence-ledger.json",
    `${JSON.stringify(
      {
        runId: "run-2026-10-15-01",
        records: [
          {
            id: "CLM-023",
            kind: "client-statement",
            sourceRef: "evidence-source/src-01",
            recordedAt: "2026-10-10T14:00:00Z",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  files.set(
    "cost-report.json",
    `${JSON.stringify(
      {
        currency: "USD",
        total: 4.2,
        steps: [{ step: "phase0-ledger", model: "claude-opus-4.1", cost: 4.2 }],
      },
      null,
      2,
    )}\n`,
  );

  const seed: IntakeBundleSeed = {
    envelope: defaultEnvelope(sourceSha, assetSha),
    files,
  };
  options.mutate?.(seed);

  // Fill sentinels unless mutate replaced them (tests inject bad values here).
  const provenance = seed.envelope.provenance as Record<string, unknown>;
  const ledgerFile = files.get("evidence-ledger.json");
  if (provenance.evidenceLedger === AUTO && ledgerFile !== undefined) {
    provenance.evidenceLedger = `sha256:${sha256Hex(new TextEncoder().encode(ledgerFile))}`;
  }
  if (provenance.contractSnapshot === AUTO) {
    const exportSha = options.exportSha256 ?? (await resolveIntakeExportSha256(io))?.sha256;
    if (!exportSha) {
      throw new Error(
        "buildIntakeBundle: intake.schema.generated.yaml not found — run onboarding.intake.schema.export first",
      );
    }
    provenance.contractSnapshot = exportSha;
  }

  // Write payload files (manifest is hashed afterwards, so intake.json counts too).
  for (const [rel, content] of files) {
    await io.writeFile(join(dir, rel), content);
  }
  await io.writeFile(join(dir, "intake.json"), `${JSON.stringify(seed.envelope, null, 2)}\n`);

  // MANIFEST.sha256 — sha256sum format, sorted, covering every file but itself.
  const allFiles = [...files.keys(), "intake.json"].sort();
  const lines: string[] = [];
  for (const rel of allFiles) {
    const bytes = await io.readFileBytes(join(dir, rel));
    lines.push(`${sha256Hex(bytes)}  ${rel}`);
  }
  let manifest = `${lines.join("\n")}\n`;
  if (options.manifestTransform) {
    manifest = options.manifestTransform(manifest);
  }
  await io.writeFile(join(dir, "MANIFEST.sha256"), manifest);

  return {
    dir,
    sourceSha256: sourceSha,
    assetSha256: assetSha,
    ledgerSha256: typeof provenance.evidenceLedger === "string" ? provenance.evidenceLedger : "",
  };
}
