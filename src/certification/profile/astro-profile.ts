/*
<MODULE_CONTRACT>
<purpose>RFC-0865: Minimal Astro certification profile for the site stack. Covers all 9 site quality dimensions with Main-gate required requirements.</purpose>
<non-goals>
  <item>Do not add producer execution, deployment decisions, or I/O — this is a static data declaration.</item>
  <item>Do not add requirements beyond the minimal 9-dimension Main-gate coverage.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0865: initial minimal Astro certification profile.</item>
  <item>ADR-0083: profileId "site" is a logical id — no profiles/site.yaml; CERT-PROFILE-02 stays test-only until wired to a live command.</item>
  <item>RFC-1295</item>
</CHANGE_SUMMARY>
*/

import type { CertificationProfileV1, CertificationRequirementV1 } from "./schemas.ts";

const DIMENSIONS = [
  "candidate-integrity",
  "business-truth-compliance",
  "editorial-localization",
  "information-architecture-discoverability",
  "ux-conversion",
  "visual-accessibility",
  "performance-runtime",
  "security-operational-readiness",
  "independent-qualitative-evaluation",
] as const;

function makeRequirement(
  dimension: (typeof DIMENSIONS)[number],
  index: number,
): CertificationRequirementV1 {
  const id = `astro-req-${String(index + 1).padStart(2, "0")}-${dimension}`;
  // RFC-1295: editorial-localization is produced by the human editorial
  // sign-off packet, not by mission.check — the check that satisfies it is
  // editorial.review.verify evaluated at promote-main.
  const editorial = dimension === "editorial-localization";
  return {
    id,
    title: `Astro ${dimension} Main-gate requirement`,
    dimension,
    gates: ["promote-main"],
    classification: "required" as const,
    applicability: { kind: "always" as const },
    producerId: editorial ? "editorial-signoff" : "astro-mission-check",
    evidenceSchema: "werkstatt/evidence@1",
    environments: ["dev", "alt", "main" as const],
    reuse: editorial
      ? // A gate-bound human decision reuses nothing cross-environment —
        // environmentIndependent: false + empty allowedFrom (CERT-PROFILE-06
        // forbids environmentIndependent with empty allowedFrom).
        { environmentIndependent: false, allowedFrom: [] }
      : {
          environmentIndependent: false,
          allowedFrom: ["dev", "alt"],
        },
    freshness: {
      maxAgeSeconds: null,
    },
    execution: {
      timeoutMs: 300000,
      maxAttempts: 2,
      backoffMs: [5000, 10000],
    },
    criticality: "ordinary" as const,
    driftAction: "retry" as const,
    remediation: {
      classification: "product-fix" as const,
      ownerRole: editorial ? ("operator-agent" as const) : ("author-agent" as const),
      reproduceCommand: editorial
        ? `pnpm exec werkstatt run editorial.review.prepare --site {site} --release <release>`
        : `pnpm exec werkstatt run mission.check --site {site}`,
      verificationCommand: editorial
        ? `pnpm exec werkstatt run editorial.review.verify --site {site} --release <release>`
        : `pnpm exec werkstatt run mission.validate --site {site}`,
    },
    normativeRefs: editorial ? ["RFC-0865", "RFC-1295"] : ["RFC-0865"],
  };
}

export const astroCertificationProfile: CertificationProfileV1 = {
  schema: "werkstatt/certification-profile@1",
  id: "astro-certification-profile",
  version: "1.0.0",
  plugin: {
    id: "werkstatt-site",
    profileId: "site",
  },
  dimensions: [...DIMENSIONS],
  producers: {
    "astro-mission-check": {
      id: "astro-mission-check",
      kind: "kernel-command",
      command: "mission.check",
      outputSchema: "werkstatt/evidence@1",
      versionSource: "package-version",
      requiredPayloadRoles: ["check-result"],
    },
    // RFC-1295: human editorial sign-off — certify.ts dispatches
    // editorial.review.verify against the release's packet.
    "editorial-signoff": {
      id: "editorial-signoff",
      kind: "kernel-command",
      command: "editorial.review.verify",
      outputSchema: "werkstatt/evidence@1",
      versionSource: "package-version",
      requiredPayloadRoles: ["check-result"],
    },
  },
  requirements: DIMENSIONS.map(makeRequirement),
  retentionPolicy: {
    minRetentionDays: 30,
    maxRetentionDays: 365,
    tombstoneAfterDays: 365,
  },
};
