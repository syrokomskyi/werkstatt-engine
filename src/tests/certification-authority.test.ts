import { describe, it, expect } from "vitest";
import {
  createIssuerRegistry,
  addIssuer,
  isIssuerRegistered,
  verifyAttestation,
  verifySignedDecision,
  verifySignedRoot,
} from "../certification/authority/index.ts";
import type {
  IssuerRegistryEntryV1,
  SignedDecisionV1,
  SignedRootV1,
} from "../certification/contracts/authority.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";

const PK_HASH =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Sha256Digest;
const PK_HASH_2 =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Sha256Digest;
const STMT_DIGEST =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Sha256Digest;
const SIG_DIGEST =
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as Sha256Digest;
const WRONG_PK_HASH =
  "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as Sha256Digest;
const DEC_DIGEST =
  "sha256:ffff00000000000000000000000000000000000000000000000000000000ffff" as Sha256Digest;
const SIG_1 =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111" as Sha256Digest;
const ROOT_DIGEST =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222" as Sha256Digest;
const SIG_2 =
  "sha256:3333333333333333333333333333333333333333333333333333333333333333" as Sha256Digest;

const ISSUER: IssuerRegistryEntryV1 = {
  schema: "werkstatt/issuer-registry-entry@1",
  issuerId: "issuer-001",
  version: "1.0.0",
  publicKeyRef: "key-001",
  publicKeyHash: PK_HASH,
  admittedAt: "2026-01-01T00:00:00Z",
  admittedBy: "admin",
};

describe("createIssuerRegistry", () => {
  it("creates an empty registry", () => {
    const reg = createIssuerRegistry();
    expect(reg.entries.size).toBe(0);
  });
});

describe("addIssuer", () => {
  it("adds a new issuer", () => {
    const reg = createIssuerRegistry();
    const result = addIssuer(reg, ISSUER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isIssuerRegistered(result.registry, "issuer-001")).toBe(true);
    }
  });

  it("is idempotent for same public key", () => {
    const reg = createIssuerRegistry();
    const r1 = addIssuer(reg, ISSUER);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      const r2 = addIssuer(r1.registry, ISSUER);
      expect(r2.ok).toBe(true);
    }
  });

  it("fails on conflicting public key", () => {
    const reg = createIssuerRegistry();
    const r1 = addIssuer(reg, ISSUER);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      const conflicting: IssuerRegistryEntryV1 = {
        ...ISSUER,
        publicKeyHash: PK_HASH_2,
      };
      const r2 = addIssuer(r1.registry, conflicting);
      expect(r2.ok).toBe(false);
      if (!r2.ok) {
        expect(r2.ruleId).toBe("CERT-AUTHORITY-01");
      }
    }
  });
});

describe("verifyAttestation", () => {
  it("succeeds for registered issuer with matching key", () => {
    const reg = createIssuerRegistry();
    const r = addIssuer(reg, ISSUER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const result = verifyAttestation({
        issuerId: "issuer-001",
        statementDigest: STMT_DIGEST,
        expectedPublicKeyHash: ISSUER.publicKeyHash,
        signatureDigest: SIG_DIGEST,
        registry: r.registry,
        verifiedAt: "2026-01-01T00:00:00Z",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.verification.verified).toBe(true);
      }
    }
  });

  it("fails for unregistered issuer", () => {
    const reg = createIssuerRegistry();
    const result = verifyAttestation({
      issuerId: "unknown",
      statementDigest: STMT_DIGEST,
      expectedPublicKeyHash: ISSUER.publicKeyHash,
      signatureDigest: SIG_DIGEST,
      registry: reg,
      verifiedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-AUTHORITY-02");
    }
  });

  it("fails on key mismatch", () => {
    const reg = createIssuerRegistry();
    const r = addIssuer(reg, ISSUER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const result = verifyAttestation({
        issuerId: "issuer-001",
        statementDigest: STMT_DIGEST,
        expectedPublicKeyHash: WRONG_PK_HASH,
        signatureDigest: SIG_DIGEST,
        registry: r.registry,
        verifiedAt: "2026-01-01T00:00:00Z",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.ruleId).toBe("CERT-AUTHORITY-03");
      }
    }
  });
});

describe("verifySignedDecision", () => {
  it("succeeds for registered issuer", () => {
    const reg = createIssuerRegistry();
    const r = addIssuer(reg, ISSUER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const signed: SignedDecisionV1 = {
        schema: "werkstatt/signed-decision@1",
        decisionId: "dec-001",
        decisionDigest: DEC_DIGEST,
        issuerId: "issuer-001",
        signatureDigest: SIG_1,
        signedAt: "2026-01-01T00:00:00Z",
      };
      const result = verifySignedDecision(signed, r.registry);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.valid).toBe(true);
      }
    }
  });

  it("fails for unregistered issuer", () => {
    const reg = createIssuerRegistry();
    const signed: SignedDecisionV1 = {
      schema: "werkstatt/signed-decision@1",
      decisionId: "dec-001",
      decisionDigest: DEC_DIGEST,
      issuerId: "unknown",
      signatureDigest: SIG_1,
      signedAt: "2026-01-01T00:00:00Z",
    };
    const result = verifySignedDecision(signed, reg);
    expect(result.ok).toBe(false);
  });
});

describe("verifySignedRoot", () => {
  it("succeeds for registered issuer", () => {
    const reg = createIssuerRegistry();
    const r = addIssuer(reg, ISSUER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const signed: SignedRootV1 = {
        schema: "werkstatt/signed-root@1",
        rootDigest: ROOT_DIGEST,
        issuerId: "issuer-001",
        signatureDigest: SIG_2,
        signedAt: "2026-01-01T00:00:00Z",
      };
      const result = verifySignedRoot(signed, r.registry);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.valid).toBe(true);
      }
    }
  });
});
