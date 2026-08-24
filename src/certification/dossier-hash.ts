import {
  snapshotCanonicalJsonObjectV1,
  canonicalJsonHashV1,
} from "../fingerprint/canonical-json.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type { CertificationDossierEventV1 } from "./contracts/index.ts";
import { buildDossierEventIdentityV1 } from "./identity.ts";

export type DossierHashFailureV1 = {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
};

export type DossierEventHashResultV1 = {
  readonly ok: true;
  readonly eventHash: Sha256Digest;
} | DossierHashFailureV1;

export function computeDossierEventHash(
  event: CertificationDossierEventV1,
): DossierEventHashResultV1 {
  const identityResult = buildDossierEventIdentityV1(event);
  if (!identityResult.ok) {
    return {
      ok: false,
      code: identityResult.diagnostic.code,
      message: identityResult.diagnostic.message,
    };
  }
  return { ok: true, eventHash: identityResult.digest };
}

export function computeDossierRoot(
  candidateId: string,
  orderedEventHashes: readonly Sha256Digest[],
): Sha256Digest {
  const payload = {
    schema: "werkstatt/dossier-root@1",
    candidateId,
    eventHashes: orderedEventHashes,
  };

  const snapshotResult = snapshotCanonicalJsonObjectV1(payload);
  if (!snapshotResult.ok) {
    throw new Error(
      `CERT-DOSSIER-ROOT-01: failed to snapshot dossier root: ${snapshotResult.message}`,
    );
  }

  return canonicalJsonHashV1(snapshotResult.value);
}
