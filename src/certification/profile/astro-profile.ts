/*
<MODULE_CONTRACT>
<purpose>RFC-0865: Minimal Astro certification profile for the astro-typescript-turborepo stack. Covers all 9 site quality dimensions with Main-gate required requirements.</purpose>
<non-goals>
  <item>Do not add producer execution, deployment decisions, or I/O — this is a static data declaration.</item>
  <item>Do not add requirements beyond the minimal 9-dimension Main-gate coverage.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-0865: initial minimal Astro certification profile.</item>
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
  return {
    id,
    title: `Astro ${dimension} Main-gate requirement`,
    dimension,
    gates: ["promote-main"],
    classification: "required" as const,
    applicability: { kind: "always" as const },
    producerId: "astro-mission-check",
    evidenceSchema: "werkstatt/evidence@1",
    environments: ["dev", "alt", "main" as const],
    reuse: {
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
      ownerRole: "author-agent" as const,
      reproduceCommand: `pnpm exec werkstatt run mission.check --site {site}`,
      verificationCommand: `pnpm exec werkstatt run mission.validate --site {site}`,
    },
    normativeRefs: ["RFC-0865"],
  };
}

export const astroCertificationProfile: CertificationProfileV1 = {
  schema: "werkstatt/certification-profile@1",
  id: "astro-certification-profile",
  version: "1.0.0",
  plugin: {
    id: "werkstatt-site",
    profileId: "astro-typescript-turborepo",
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
  },
  requirements: DIMENSIONS.map(makeRequirement),
  retentionPolicy: {
    minRetentionDays: 30,
    maxRetentionDays: 365,
    tombstoneAfterDays: 365,
  },
};
