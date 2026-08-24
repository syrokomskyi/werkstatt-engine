import type { CertificationDossierEventV1, DossierRootReferenceV1 } from "../contracts/dossier.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";
import { computeDossierEventHash, computeDossierRoot } from "../dossier-hash.ts";

export interface DossierRepositoryV1 {
  readonly candidateId: string;
  readonly events: readonly CertificationDossierEventV1[];
  readonly eventHashes: readonly Sha256Digest[];
  readonly rootHash: Sha256Digest | null;
}

export interface DossierAppendInputV1 {
  event: CertificationDossierEventV1;
}

export interface DossierAppendResultV1 {
  ok: true;
  repository: DossierRepositoryV1;
  eventHash: Sha256Digest;
  newRootHash: Sha256Digest;
}

export interface DossierAppendFailureV1 {
  ok: false;
  ruleId: "CERT-DOSSIER-01" | "CERT-DOSSIER-02" | "CERT-DOSSIER-03";
  message: string;
}

export type DossierAppendOutcomeV1 = DossierAppendResultV1 | DossierAppendFailureV1;

export function createDossierRepository(candidateId: string): DossierRepositoryV1 {
  return {
    candidateId,
    events: [],
    eventHashes: [],
    rootHash: null,
  };
}

export function appendDossierEvent(
  repo: DossierRepositoryV1,
  input: DossierAppendInputV1,
): DossierAppendOutcomeV1 {
  if (input.event.candidateId !== repo.candidateId) {
    return {
      ok: false,
      ruleId: "CERT-DOSSIER-01",
      message: `event candidateId "${input.event.candidateId}" does not match repository candidateId "${repo.candidateId}"`,
    };
  }

  const expectedPrevHash =
    repo.eventHashes.length === 0
      ? null
      : repo.eventHashes[repo.eventHashes.length - 1];

  if (input.event.previousEventHash !== expectedPrevHash) {
    return {
      ok: false,
      ruleId: "CERT-DOSSIER-02",
      message: `previousEventHash mismatch: expected ${expectedPrevHash}, got ${input.event.previousEventHash}`,
    };
  }

  if (repo.events.length >= 100000) {
    return {
      ok: false,
      ruleId: "CERT-DOSSIER-03",
      message: "dossier event limit (100000) exceeded",
    };
  }

  const hashResult = computeDossierEventHash(input.event);
  if (!hashResult.ok) {
    return {
      ok: false,
      ruleId: "CERT-DOSSIER-02",
      message: `failed to compute event hash: ${hashResult.code} — ${hashResult.message}`,
    };
  }

  const newEvents = [...repo.events, input.event];
  const newEventHashes = [...repo.eventHashes, hashResult.eventHash];
  const newRootHash = computeDossierRoot(repo.candidateId, newEventHashes);

  return {
    ok: true,
    repository: {
      candidateId: repo.candidateId,
      events: newEvents,
      eventHashes: newEventHashes,
      rootHash: newRootHash,
    },
    eventHash: hashResult.eventHash,
    newRootHash,
  };
}

export function rebuildRootHash(repo: DossierRepositoryV1): Sha256Digest {
  return computeDossierRoot(repo.candidateId, repo.eventHashes);
}

export function buildRootReference(
  repo: DossierRepositoryV1,
): DossierRootReferenceV1 {
  return {
    schema: "werkstatt/dossier-root-reference@1",
    rootHash: repo.rootHash ?? computeDossierRoot(repo.candidateId, []),
    candidateId: repo.candidateId,
    eventCount: repo.events.length,
  };
}

export interface DossierIntegrityVerifyResultV1 {
  ok: true;
  valid: boolean;
  recomputedRootHash: Sha256Digest;
}

export interface DossierIntegrityVerifyFailureV1 {
  ok: false;
  ruleId: "CERT-DOSSIER-04";
  message: string;
}

export type DossierIntegrityVerifyOutcomeV1 =
  | DossierIntegrityVerifyResultV1
  | DossierIntegrityVerifyFailureV1;

export function verifyDossierIntegrity(
  repo: DossierRepositoryV1,
): DossierIntegrityVerifyOutcomeV1 {
  const recomputedHashes: Sha256Digest[] = [];
  let prevHash: Sha256Digest | null = null;

  for (const event of repo.events) {
    if (event.previousEventHash !== prevHash) {
      return {
        ok: false,
        ruleId: "CERT-DOSSIER-04",
        message: `chain break at event ${event.eventId}: expected previousEventHash ${prevHash}, got ${event.previousEventHash}`,
      };
    }
    const hashResult = computeDossierEventHash(event);
    if (!hashResult.ok) {
      return {
        ok: false,
        ruleId: "CERT-DOSSIER-04",
        message: `failed to hash event ${event.eventId}: ${hashResult.code}`,
      };
    }
    recomputedHashes.push(hashResult.eventHash);
    prevHash = hashResult.eventHash;
  }

  const recomputedRoot = computeDossierRoot(repo.candidateId, recomputedHashes);
  const valid = repo.rootHash === null || repo.rootHash === recomputedRoot;

  return {
    ok: true,
    valid,
    recomputedRootHash: recomputedRoot,
  };
}
