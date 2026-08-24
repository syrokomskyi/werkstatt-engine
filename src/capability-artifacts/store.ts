import type { Sha256Digest } from "../fingerprint/primitives.ts";
import { byteHash } from "../fingerprint/primitives.ts";
import type { WorkloadLimitsV1 } from "../isolation/contracts.ts";

export interface ArtifactProvenanceV1 {
  schema: "werkstatt/artifact-provenance@1";
  sourceCommit: string;
  buildCommand: string;
  builderId: string;
  builtAt: string;
  reproducible: boolean;
}

export interface CapabilityArtifactV1 {
  schema: "werkstatt/capability-artifact@1";
  artifactHash: Sha256Digest;
  manifestHash: Sha256Digest;
  payloadHash: Sha256Digest;
  mediaType: string;
  sizeBytes: number;
  provenance: ArtifactProvenanceV1;
}

export interface ArtifactPublishRequestV1 {
  manifestBytes: Uint8Array;
  payloadBytes: Uint8Array;
  mediaType: string;
  provenance: ArtifactProvenanceV1;
}

export interface ArtifactPublishResultV1 {
  ok: true;
  artifact: CapabilityArtifactV1;
}

export interface ArtifactPublishFailureV1 {
  ok: false;
  ruleId: "CERT-ARTIFACT-01" | "CERT-ARTIFACT-02" | "CERT-ARTIFACT-03";
  message: string;
}

export type ArtifactPublishOutcomeV1 = ArtifactPublishResultV1 | ArtifactPublishFailureV1;

export interface ArtifactStoreV1 {
  publish(request: ArtifactPublishRequestV1): ArtifactPublishOutcomeV1;
  get(artifactHash: Sha256Digest): CapabilityArtifactV1 | null;
  verify(artifactHash: Sha256Digest, expectedBytes: Uint8Array): ArtifactVerifyOutcomeV1;
  list(): readonly Sha256Digest[];
}

export interface ArtifactVerifyResultV1 {
  ok: true;
  verified: true;
}

export interface ArtifactVerifyFailureV1 {
  ok: false;
  ruleId: "CERT-ARTIFACT-04" | "CERT-ARTIFACT-05";
  message: string;
}

export type ArtifactVerifyOutcomeV1 = ArtifactVerifyResultV1 | ArtifactVerifyFailureV1;

const MAX_ARTIFACT_SIZE = 256 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "application/vnd.werkstatt.capability+json",
  "application/vnd.werkstatt.capability+binary",
  "application/javascript",
  "application/wasm",
]);

export function createInMemoryArtifactStore(): ArtifactStoreV1 {
  const artifacts = new Map<string, CapabilityArtifactV1>();
  const payloadStore = new Map<string, Uint8Array>();

  return {
    publish(request: ArtifactPublishRequestV1): ArtifactPublishOutcomeV1 {
      if (request.payloadBytes.length > MAX_ARTIFACT_SIZE) {
        return {
          ok: false,
          ruleId: "CERT-ARTIFACT-01",
          message: `artifact size ${request.payloadBytes.length} exceeds maximum ${MAX_ARTIFACT_SIZE}`,
        };
      }

      if (!ALLOWED_MEDIA_TYPES.has(request.mediaType)) {
        return {
          ok: false,
          ruleId: "CERT-ARTIFACT-02",
          message: `media type "${request.mediaType}" is not allowed`,
        };
      }

      const manifestHash = byteHash(request.manifestBytes);
      const payloadHash = byteHash(request.payloadBytes);
      const manifestObj: Record<string, unknown> = {
        manifestHash: manifestHash,
        payloadHash: payloadHash,
        mediaType: request.mediaType,
        sizeBytes: request.payloadBytes.length,
        provenance: request.provenance,
      };
      const artifactHash = byteHash(new TextEncoder().encode(JSON.stringify(manifestObj)));

      if (artifacts.has(artifactHash)) {
        return {
          ok: false,
          ruleId: "CERT-ARTIFACT-03",
          message: `artifact ${artifactHash} is already published — artifacts are immutable`,
        };
      }

      const artifact: CapabilityArtifactV1 = {
        schema: "werkstatt/capability-artifact@1",
        artifactHash,
        manifestHash,
        payloadHash,
        mediaType: request.mediaType,
        sizeBytes: request.payloadBytes.length,
        provenance: request.provenance,
      };

      artifacts.set(artifactHash, artifact);
      payloadStore.set(artifactHash, request.payloadBytes);

      return { ok: true, artifact };
    },

    get(artifactHash: Sha256Digest): CapabilityArtifactV1 | null {
      return artifacts.get(artifactHash) ?? null;
    },

    verify(artifactHash: Sha256Digest, expectedBytes: Uint8Array): ArtifactVerifyOutcomeV1 {
      const artifact = artifacts.get(artifactHash);
      if (!artifact) {
        return {
          ok: false,
          ruleId: "CERT-ARTIFACT-04",
          message: `artifact ${artifactHash} not found`,
        };
      }

      const storedBytes = payloadStore.get(artifactHash);
      if (!storedBytes) {
        return {
          ok: false,
          ruleId: "CERT-ARTIFACT-04",
          message: `artifact ${artifactHash} payload missing from store`,
        };
      }

      const expectedHash = byteHash(expectedBytes);
      if (expectedHash !== artifact.payloadHash) {
        return {
          ok: false,
          ruleId: "CERT-ARTIFACT-05",
          message: `payload hash mismatch: expected ${artifact.payloadHash}, got ${expectedHash}`,
        };
      }

      return { ok: true, verified: true };
    },

    list(): readonly Sha256Digest[] {
      return [...artifacts.keys()] as Sha256Digest[];
    },
  };
}

export interface SandboxProviderAdmissionV1 {
  schema: "werkstatt/sandbox-provider-admission@1";
  adapterId: string;
  adapterVersion: string;
  conformanceHash: Sha256Digest;
  policyHash: Sha256Digest;
  decision: "pass" | "fail" | "incomplete";
}

export interface ProviderAdmissionStoreV1 {
  admit(admission: SandboxProviderAdmissionV1): ProviderAdmitOutcomeV1;
  get(adapterId: string): SandboxProviderAdmissionV1 | null;
  isAdmitted(adapterId: string): boolean;
}

export interface ProviderAdmitResultV1 {
  ok: true;
  admitted: true;
}

export interface ProviderAdmitFailureV1 {
  ok: false;
  ruleId: "CERT-ARTIFACT-06" | "CERT-ARTIFACT-07";
  message: string;
}

export type ProviderAdmitOutcomeV1 = ProviderAdmitResultV1 | ProviderAdmitFailureV1;

export function createProviderAdmissionStore(): ProviderAdmissionStoreV1 {
  const admissions = new Map<string, SandboxProviderAdmissionV1>();

  return {
    admit(admission: SandboxProviderAdmissionV1): ProviderAdmitOutcomeV1 {
      if (admission.decision !== "pass") {
        return {
          ok: false,
          ruleId: "CERT-ARTIFACT-06",
          message: `adapter "${admission.adapterId}" admission decision is "${admission.decision}" — only "pass" is admitted`,
        };
      }

      const existing = admissions.get(admission.adapterId);
      if (existing && existing.conformanceHash !== admission.conformanceHash) {
        return {
          ok: false,
          ruleId: "CERT-ARTIFACT-07",
          message: `adapter "${admission.adapterId}" conformance hash changed — stale evidence is not admitted`,
        };
      }

      admissions.set(admission.adapterId, admission);
      return { ok: true, admitted: true };
    },

    get(adapterId: string): SandboxProviderAdmissionV1 | null {
      return admissions.get(adapterId) ?? null;
    },

    isAdmitted(adapterId: string): boolean {
      const admission = admissions.get(adapterId);
      return admission !== null && admission !== undefined && admission.decision === "pass";
    },
  };
}

export interface CapabilityInvocationV1 {
  schema: "werkstatt/capability-invocation@1";
  artifactHash: Sha256Digest;
  grantSetHash: Sha256Digest;
  inputHash: Sha256Digest;
  limits: WorkloadLimitsV1;
  idempotencyKey: string;
}
