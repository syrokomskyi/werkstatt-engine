/*
<MODULE_CONTRACT>
<purpose>dossier-hash — compute and verify certification dossier content hashes for integrity checks.</purpose>
<non-goals>
  <item>Do not write dossiers — this module only hashes them.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

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
