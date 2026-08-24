import type { IssuerRegistryEntryV1, AttestationVerificationV1, SignedDecisionV1, SignedRootV1 } from "../contracts/authority.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

export interface IssuerRegistryV1 {
  entries: Map<string, IssuerRegistryEntryV1>;
}

export interface IssuerRegistryAddResultV1 {
  ok: true;
  registry: IssuerRegistryV1;
}

export interface IssuerRegistryAddFailureV1 {
  ok: false;
  ruleId: "CERT-AUTHORITY-01" | "CERT-AUTHORITY-02";
  message: string;
}

export type IssuerRegistryAddOutcomeV1 =
  | IssuerRegistryAddResultV1
  | IssuerRegistryAddFailureV1;

export function createIssuerRegistry(): IssuerRegistryV1 {
  return { entries: new Map() };
}

export function addIssuer(
  registry: IssuerRegistryV1,
  entry: IssuerRegistryEntryV1,
): IssuerRegistryAddOutcomeV1 {
  const existing = registry.entries.get(entry.issuerId);
  if (existing) {
    if (existing.publicKeyHash !== entry.publicKeyHash) {
      return {
        ok: false,
        ruleId: "CERT-AUTHORITY-01",
        message: `issuer "${entry.issuerId}" already registered with different public key`,
      };
    }
    return { ok: true, registry };
  }

  const newEntries = new Map(registry.entries);
  newEntries.set(entry.issuerId, entry);
  return { ok: true, registry: { entries: newEntries } };
}

export function isIssuerRegistered(
  registry: IssuerRegistryV1,
  issuerId: string,
): boolean {
  return registry.entries.has(issuerId);
}

export interface AttestationVerifyInputV1 {
  issuerId: string;
  statementDigest: Sha256Digest;
  expectedPublicKeyHash: Sha256Digest;
  signatureDigest: Sha256Digest;
  registry: IssuerRegistryV1;
  verifiedAt: string;
}

export interface AttestationVerifyResultV1 {
  ok: true;
  verification: AttestationVerificationV1;
}

export interface AttestationVerifyFailureV1 {
  ok: false;
  ruleId: "CERT-AUTHORITY-02" | "CERT-AUTHORITY-03";
  message: string;
}

export type AttestationVerifyOutcomeV1 =
  | AttestationVerifyResultV1
  | AttestationVerifyFailureV1;

export function verifyAttestation(
  input: AttestationVerifyInputV1,
): AttestationVerifyOutcomeV1 {
  const entry = input.registry.entries.get(input.issuerId);
  if (!entry) {
    return {
      ok: false,
      ruleId: "CERT-AUTHORITY-02",
      message: `issuer "${input.issuerId}" is not registered`,
    };
  }

  if (entry.publicKeyHash !== input.expectedPublicKeyHash) {
    return {
      ok: false,
      ruleId: "CERT-AUTHORITY-03",
      message: `public key hash mismatch for issuer "${input.issuerId}"`,
    };
  }

  return {
    ok: true,
    verification: {
      schema: "werkstatt/attestation-verification@1",
      issuerId: input.issuerId,
      statementDigest: input.statementDigest,
      verifiedAt: input.verifiedAt,
      verified: true,
    },
  };
}

export interface SignedDecisionVerifyResultV1 {
  ok: true;
  valid: boolean;
  signedDecision: SignedDecisionV1;
}

export interface SignedDecisionVerifyFailureV1 {
  ok: false;
  ruleId: "CERT-AUTHORITY-02" | "CERT-AUTHORITY-04";
  message: string;
}

export type SignedDecisionVerifyOutcomeV1 =
  | SignedDecisionVerifyResultV1
  | SignedDecisionVerifyFailureV1;

export function verifySignedDecision(
  signed: SignedDecisionV1,
  registry: IssuerRegistryV1,
): SignedDecisionVerifyOutcomeV1 {
  if (!isIssuerRegistered(registry, signed.issuerId)) {
    return {
      ok: false,
      ruleId: "CERT-AUTHORITY-02",
      message: `issuer "${signed.issuerId}" is not registered`,
    };
  }

  return {
    ok: true,
    valid: true,
    signedDecision: signed,
  };
}

export interface SignedRootVerifyResultV1 {
  ok: true;
  valid: boolean;
  signedRoot: SignedRootV1;
}

export interface SignedRootVerifyFailureV1 {
  ok: false;
  ruleId: "CERT-AUTHORITY-02" | "CERT-AUTHORITY-05";
  message: string;
}

export type SignedRootVerifyOutcomeV1 =
  | SignedRootVerifyResultV1
  | SignedRootVerifyFailureV1;

export function verifySignedRoot(
  signed: SignedRootV1,
  registry: IssuerRegistryV1,
): SignedRootVerifyOutcomeV1 {
  if (!isIssuerRegistered(registry, signed.issuerId)) {
    return {
      ok: false,
      ruleId: "CERT-AUTHORITY-02",
      message: `issuer "${signed.issuerId}" is not registered`,
    };
  }

  return {
    ok: true,
    valid: true,
    signedRoot: signed,
  };
}
