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
