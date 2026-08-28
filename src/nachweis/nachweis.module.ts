/*
<MODULE_CONTRACT>
<purpose>RFC-0707/RFC-0714/RFC-0715/RFC-0873/RFC-0886: Nachweis kernel module — registers 14 nachweis.* commands with lazy-loaded handlers.</purpose>
<keywords>nachweis, module, kernel, commands, registration</keywords>
<responsibilities>
  <item>Registers nachweis.ingest, nachweis.validate, nachweis.manifest.generate, nachweis.consent.update, nachweis.publish, nachweis.withdraw, nachweis.approve, nachweis.public-derivative.</item>
  <item>RFC-0873: Registers nachweis.assessment.ingest for technical-assessment bundle ingestion.</item>
  <item>RFC-0874: Registers nachweis.measure.lighthouse for reproducible Lighthouse assessment measurement.</item>
  <item>RFC-0875: Registers nachweis.measure.cloudflare-agent-readiness for Cloudflare URL Scanner Agent Readiness assessment.</item>
  <item>RFC-0715: Registers nachweis.key.ensure, nachweis.sign, nachweis.timestamp, nachweis.verify-signature.</item>
  <item>RFC-0886: Registers nachweis.screenshot.upload for website screenshot upload to R2.</item>
  <item>RFC-0890: Registers nachweis.screenshot.ingest for raw screenshot ingestion to R2 private + cache clone.</item>
  <item>RFC-0891: Registers nachweis.screenshot.process for raw-to-display screenshot processing (crop, resize, WebP).</item>
  <item>Uses dynamic imports for lazy loading (same pattern as evidence-module.ts and bordbuch.module.ts).</item>
  <item>Declares correct scopes, flags, reads/writes for each command.</item>
</responsibilities>
<non-goals>
  <item>Does not implement command handlers — those live in nachweis-*.ts files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0707: initial nachweis kernel module with 6 command registrations.</item>
  <item>RFC-0714: add nachweis.approve and nachweis.public-derivative command registrations.</item>
  <item>RFC-0715: add nachweis.key.ensure, nachweis.sign, nachweis.timestamp, nachweis.verify-signature. Remove --pilot-n2-exception from nachweis.publish.</item>
  <item>RFC-0871: add --timestamp-assurance and --qualification-evidence-ref flags to nachweis.timestamp.</item>
  <item>RFC-0872: update nachweis.validate, nachweis.publish, nachweis.withdraw descriptions to reflect policy-driven V2 gates.</item>
  <item>RFC-0873: add nachweis.assessment.ingest command registration.</item>
  <item>RFC-0874: add nachweis.measure.lighthouse command registration.</item>
  <item>RFC-0875: add nachweis.measure.cloudflare-agent-readiness command registration.</item>
  <item>RFC-0886: add nachweis.screenshot.upload command registration, add --scope flag to nachweis.consent.update.</item>
  <item>RFC-0890: add nachweis.screenshot.ingest command registration.</item>
  <item>RFC-0891: add nachweis.screenshot.process command registration.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createNachweisModule(): KernelModule {
  return {
    name: "nachweis",
    version: "0.1.0",
    async register(registry) {
      const { runNachweisIngest } = await import("./nachweis-ingest.ts");
      const { runNachweisValidate } = await import("./nachweis-validate.ts");
      const { runNachweisManifestGenerate } = await import("./nachweis-manifest.ts");
      const { runNachweisConsentUpdate } = await import("./nachweis-consent.ts");
      const { runNachweisPublish } = await import("./nachweis-publish.ts");
      const { runNachweisWithdraw } = await import("./nachweis-withdraw.ts");
      const { runNachweisApprove } = await import("./nachweis-approve.ts");
      const { runNachweisPublicDerivative } = await import("./nachweis-public-derivative.ts");
      const { runNachweisKeyEnsure } = await import("./nachweis-key-ensure.ts");
      const { runNachweisSign } = await import("./nachweis-sign.ts");
      const { runNachweisTimestamp } = await import("./nachweis-timestamp.ts");
      const { runNachweisVerifySignature } = await import("./nachweis-verify-signature.ts");
      const { runNachweisAssessmentIngest } = await import("./nachweis-assessment-ingest.ts");
      const { runNachweisLighthouseMeasure } = await import("./nachweis-lighthouse-measure.ts");
      const { runNachweisCloudflareAgentReadinessMeasure } =
        await import("./nachweis-cloudflare-agent-readiness-measure.ts");
      const { runNachweisScreenshotUpload } = await import("./nachweis-screenshot-upload.ts");
      const { runNachweisScreenshotIngest } = await import("./nachweis-screenshot-ingest.ts");
      const { runNachweisScreenshotProcess } = await import("./nachweis-screenshot-process.ts");

      registry.registerCommand({
        name: "nachweis.ingest",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0707: Ingest a PDF evidence document — compute SHA-256, upload to R2, append Bordbuch entry.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          file: { kind: "string", required: true, description: "Path to PDF file to ingest" },
          "record-type": {
            kind: "string",
            required: true,
            description: "Record type (e.g. client-statement, certificate)",
          },
          slug: { kind: "string", required: true, description: "URL-safe slug for the record" },
          "title-de": { kind: "string", required: true, description: "German title" },
          "title-uk": { kind: "string", required: true, description: "Ukrainian title" },
          "title-en": { kind: "string", description: "English title (optional)" },
          "quality-status": { kind: "string", description: "Quality status (default: unverified)" },
          "dry-run": { kind: "boolean", description: "Skip R2 upload and Bordbuch append" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisIngest,
      });

      registry.registerCommand({
        name: "nachweis.validate",
        contract: "nachweis",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0707/RFC-0872: Validate PBP trust entities and enforce policy-driven publication gate V2 conditions (attestation-v1, operational-measurement-v1, technical-assessment-v1).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisValidate,
      });

      registry.registerCommand({
        name: "nachweis.manifest.generate",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        description:
          "RFC-0707: Generate public/nachweise/manifest.json from published records (generatedAt: null per RFC-0602).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          json: { kind: "boolean", description: "Output JSON result." },
          // RFC-0888: Internal coordination flag — set by nachweis.publish and
          // nachweis.withdraw to prevent duplicate sichtpass Bordbuch entries.
          // Not documented in CLI help.
          "skip-bordbuch": {
            kind: "boolean",
            description:
              "Internal: skip sichtpass Bordbuch append (used by nachweis.publish and nachweis.withdraw).",
          },
        },
        reads: [],
        writes: ["<cache>/public/nachweise/manifest.json"],
        generates: [],
        execute: runNachweisManifestGenerate,
      });

      registry.registerCommand({
        name: "nachweis.consent.update",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0707/RFC-0886: Update PBP Consent entity's consentScope[scope] and append nachweis-consent Bordbuch entry. Granular per-aspect consent via --scope flag.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          "consent-id": { kind: "string", required: true, description: "Consent entity ID (slug)" },
          scope: {
            kind: "string",
            required: true,
            description: "Consent scope aspect (document|screenshot|websiteLink)",
          },
          status: {
            kind: "string",
            required: true,
            description: "New consent status (requested|granted|revoked)",
          },
          method: {
            kind: "string",
            description: "Consent method (verified_business_email|signed_pdf|qes|none)",
          },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisConsentUpdate,
      });

      registry.registerCommand({
        name: "nachweis.publish",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0707/RFC-0872: Enforce policy-driven publication gate V2 and transition record to published. Gate policy resolved by evidence kind; technical-assessment does not require consent or public derivative.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          slug: { kind: "string", required: true, description: "Record slug to publish" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisPublish,
      });

      registry.registerCommand({
        name: "nachweis.withdraw",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0707/RFC-0872: Withdraw a published record — consent revocation is policy-driven (attestation only), set withdrawn status, regenerate manifest. Idempotent.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          slug: { kind: "string", required: true, description: "Record slug to withdraw" },
          reason: { kind: "string", description: "Withdrawal reason" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisWithdraw,
      });

      registry.registerCommand({
        name: "nachweis.approve",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0714: Record human approval, verification level, and legal content check in a Bordbuch entry. Operator-invoked only.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          slug: { kind: "string", required: true, description: "Record slug to approve" },
          "verification-level": {
            kind: "string",
            required: true,
            description: "Verification level: N0, N1, N2, N3",
          },
          "legal-content-check": {
            kind: "string",
            required: true,
            description: "Legal content check result: passed or failed",
          },
          "dry-run": {
            kind: "boolean",
            description: "Skip Bordbuch write, return what would happen",
          },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisApprove,
      });

      registry.registerCommand({
        name: "nachweis.public-derivative",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0714: Upload a public-derivative PDF to R2 and update evidence-source items.public.storage to public. Idempotent by SHA-256.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          slug: {
            kind: "string",
            required: true,
            description: "Record slug to create public derivative for",
          },
          file: {
            kind: "string",
            required: true,
            description: "Path to the public-derivative PDF file",
          },
          "dry-run": { kind: "boolean", description: "Skip R2 upload and entity update" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisPublicDerivative,
      });

      registry.registerCommand({
        name: "nachweis.key.ensure",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0715: Generate an Ed25519 keypair for Nachweis operator signatures. Writes private key to file, publishes public key JSON.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          "key-file": {
            kind: "string",
            required: true,
            description:
              "Path to write the private key (hex). Should be outside the repo, e.g. ~/.warpgogol/nachweis-signing.key",
          },
          force: { kind: "boolean", description: "Overwrite existing key file" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisKeyEnsure,
      });

      registry.registerCommand({
        name: "nachweis.sign",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0715: Sign a Nachweis record with an Ed25519 operator key. Appends nachweis-signed Bordbuch entry. Idempotent.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          slug: { kind: "string", required: true, description: "Record slug to sign" },
          "key-file": {
            kind: "string",
            required: true,
            description: "Path to the Ed25519 private key file (hex)",
          },
          "dry-run": { kind: "boolean", description: "Skip Bordbuch write" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisSign,
      });

      registry.registerCommand({
        name: "nachweis.timestamp",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0715/RFC-0871: Obtain an RFC 3161 timestamp token for a signed Nachweis record. Requires nachweis.sign to have run first. Idempotent. RFC-0871: --timestamp-assurance distinguishes rfc3161 (default) from eidas-qualified (requires --qualification-evidence-ref).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          slug: { kind: "string", required: true, description: "Record slug to timestamp" },
          "tsa-url": { kind: "string", description: "Custom TSA URL (default: freetsa.org/tsr)" },
          "timestamp-assurance": {
            kind: "string",
            description: "Timestamp assurance level (rfc3161 | eidas-qualified, default: rfc3161)",
          },
          "qualification-evidence-ref": {
            kind: "string",
            description:
              "Evidence reference URL (required when --timestamp-assurance=eidas-qualified)",
          },
          "dry-run": { kind: "boolean", description: "Skip TSA query and Bordbuch write" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisTimestamp,
      });

      registry.registerCommand({
        name: "nachweis.assessment.ingest",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0873: Ingest a technical-assessment bundle (AssessmentBundleV1) — validate, hash artifacts, upload to R2, write PBP evidence-source, append Bordbuch entry.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          bundle: {
            kind: "string",
            required: true,
            description: "Path to AssessmentBundleV1 JSON file",
          },
          "dry-run": {
            kind: "boolean",
            description: "Skip R2 upload, PBP write, and Bordbuch append",
          },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisAssessmentIngest,
      });

      registry.registerCommand({
        name: "nachweis.measure.lighthouse",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0874: Run five sequential canonical Google Lighthouse runs, parse LHR JSON, aggregate categories, build AssessmentBundleV1, and delegate to nachweis.assessment.ingest.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          url: {
            kind: "string",
            required: true,
            description: "Target HTTPS URL to measure with Lighthouse",
          },
          "series-id": {
            kind: "string",
            description: "Assessment series ID (default: lighthouse-pilot)",
          },
          "authorization-basis": {
            kind: "string",
            description:
              "Authorization basis: site-owner (default), service-contract, explicit-operator",
          },
          runs: {
            kind: "string",
            description: "Number of sequential Lighthouse runs (default: 5)",
          },
          methodology: {
            kind: "string",
            description:
              "Methodology ID and version in format <id>@<version> (default: WG-LH-01@1.0)",
          },
          "freshness-days": {
            kind: "string",
            description: "Freshness max age in days (default: 30)",
          },
          "dry-run": {
            kind: "boolean",
            description: "Skip Lighthouse execution and ingest — return dry-run result",
          },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisLighthouseMeasure,
      });

      registry.registerCommand({
        name: "nachweis.measure.cloudflare-agent-readiness",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0875: Submit an Unlisted Cloudflare URL Scanner scan with Agent Readiness enabled, poll for completion, parse dimensions, build AssessmentBundleV1, and delegate to nachweis.assessment.ingest.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          url: {
            kind: "string",
            required: true,
            description: "Target HTTPS URL to scan with Cloudflare URL Scanner",
          },
          "series-id": {
            kind: "string",
            description: "Assessment series ID (default: cloudflare-agent-readiness-pilot)",
          },
          "authorization-basis": {
            kind: "string",
            description:
              "Authorization basis: site-owner (default), service-contract, explicit-operator",
          },
          methodology: {
            kind: "string",
            description:
              "Methodology ID and version in format <id>@<version> (default: CF-AR-01@1.0)",
          },
          "freshness-days": {
            kind: "string",
            description: "Freshness max age in days (default: 30)",
          },
          "dry-run": {
            kind: "boolean",
            description: "Skip API call and ingest — return dry-run result",
          },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisCloudflareAgentReadinessMeasure,
      });

      registry.registerCommand({
        name: "nachweis.verify-signature",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0715: Verify the Ed25519 operator signature and RFC 3161 timestamp for a Nachweis record. Read-only.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          slug: { kind: "string", required: true, description: "Record slug to verify" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisVerifySignature,
      });

      registry.registerCommand({
        name: "nachweis.screenshot.upload",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0886: Upload a website screenshot to R2 and update EvidenceSource.websiteScreenshot. Supports .webp, .png, .jpg, .jpeg.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          slug: {
            kind: "string",
            required: true,
            description: "Evidence-source slug to attach the screenshot to",
          },
          file: {
            kind: "string",
            required: true,
            description: "Path to the screenshot file (.webp, .png, .jpg, .jpeg)",
          },
          "dry-run": { kind: "boolean", description: "Skip R2 upload and entity update" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisScreenshotUpload,
      });

      registry.registerCommand({
        name: "nachweis.screenshot.ingest",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0890: Ingest a raw full-page screenshot to R2 private storage and cache clone. Detects image metadata via sharp, parses CaptureX filename for capturedAt, idempotent by SHA-256.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          slug: {
            kind: "string",
            required: true,
            description: "Evidence-source slug to attach the raw screenshot to",
          },
          file: {
            kind: "string",
            required: true,
            description: "Path to the raw screenshot file",
          },
          "captured-at": {
            kind: "string",
            description: "ISO 8601 capture timestamp (overrides filename-parsed value)",
          },
          "dry-run": {
            kind: "boolean",
            description: "Compute metadata without copying or uploading",
          },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisScreenshotIngest,
      });

      registry.registerCommand({
        name: "nachweis.screenshot.process",
        modulePath: "packages/werkstatt-engine/src/nachweis/nachweis.module.ts",
        generates: [],
        description:
          "RFC-0891: Process a raw full-page screenshot into a 16:9 display variant (1280x720, WebP) and upload to R2 public. Reads rawArtifact from evidence-source, crops from top, resizes, converts.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          slug: {
            kind: "string",
            required: true,
            description: "Evidence-source slug to process the screenshot for",
          },
          "dry-run": {
            kind: "boolean",
            description: "Compute crop dimensions without uploading or updating entity",
          },
          "crop-offset": {
            kind: "string",
            description: "Vertical crop offset in pixels (default: 0, top of page)",
          },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runNachweisScreenshotProcess,
      });
    },
  };
}
