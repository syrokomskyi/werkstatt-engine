/*
<MODULE_CONTRACT>
<purpose>profile hash — compute certification profile content hashes for change detection.</purpose>
<non-goals>
  <item>Do not validate profiles — this module only hashes them.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { Sha256Digest } from "../../fingerprint/primitives.ts";
import {
  snapshotCanonicalJsonObjectV1,
  canonicalJsonHashV1,
} from "../../fingerprint/canonical-json.ts";
import type { CertificationProfileV1 } from "./schemas.ts";

export interface ProfileHashResultV1 {
  ok: true;
  canonicalHash: Sha256Digest;
}

export interface ProfileHashFailureV1 {
  ok: false;
  ruleId: "CERT-PROFILE-HASH-01";
  message: string;
}

export type ProfileHashOutcomeV1 = ProfileHashResultV1 | ProfileHashFailureV1;

export function hashCertificationProfileV1(profile: CertificationProfileV1): ProfileHashOutcomeV1 {
  const identityPayload: Record<string, unknown> = {
    schema: profile.schema,
    id: profile.id,
    version: profile.version,
    plugin: profile.plugin,
    dimensions: profile.dimensions,
    producers: profile.producers,
    requirements: profile.requirements,
    retentionPolicy: profile.retentionPolicy,
  };

  if (profile.evaluatorPolicy) {
    identityPayload.evaluatorPolicy = profile.evaluatorPolicy;
  }

  const snapshotResult = snapshotCanonicalJsonObjectV1(identityPayload);
  if (!snapshotResult.ok) {
    return {
      ok: false,
      ruleId: "CERT-PROFILE-HASH-01",
      message: `canonical snapshot failed: ${snapshotResult.code}`,
    };
  }

  const hash = canonicalJsonHashV1(snapshotResult.value);
  return { ok: true, canonicalHash: hash };
}
