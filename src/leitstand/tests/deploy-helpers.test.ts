import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  authorizeAndDeploy,
  resolveArtifactHash,
  makeR2ConfigFromEnv,
  buildEffectRecord,
  writeDeploymentEffectRecord,
} from "../deploy-helpers.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

const validGateDecision = {
  schema: "werkstatt/gate-decision@1",
  decisionId: "dec-001",
  candidateId: "test-candidate",
  policyBundleRoot: "sha256:" + "c".repeat(64),
  gate: "dev",
  evaluationCut: 1,
  selectedEvidence: [],
  status: "pass",
  coverage: {
    schema: "werkstatt/coverage-report@1",
    totalRequirements: 9,
    coveredRequirements: 9,
    uncoveredRequirements: [],
  },
  reasons: ["all requirements passed"],
  actionPackRef: null,
  decidedAt: "2026-01-01T00:00:00Z",
};

const _validMainVerificationDecision = {
  schema: "werkstatt/main-verification-decision@1",
  decisionId: "dec-main-001",
  candidateId: "test-candidate",
  policyBundleRoot: "sha256:" + "c".repeat(64),
  gate: "main",
  evaluationCut: 1,
  selectedEvidence: [],
  status: "pass",
  coverage: {
    schema: "werkstatt/coverage-report@1",
    totalRequirements: 9,
    coveredRequirements: 9,
    uncoveredRequirements: [],
  },
  reasons: ["all requirements passed"],
  actionPackRef: null,
  rootDossierRef: "sha256:" + "b".repeat(64),
  priorOperationRef: null,
  decidedAt: "2026-01-01T00:00:00Z",
};

const testArtifactHash = ("sha256:" + "a".repeat(64)) as Sha256Digest;

describe("deploy-helpers", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deploy-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("resolveArtifactHash", () => {
    it("returns hash from flag when valid", async () => {
      const hash = await resolveArtifactHash(testArtifactHash, undefined);
      expect(hash).toBe(testArtifactHash);
    });

    it("throws when flag is invalid and no release dir", async () => {
      await expect(resolveArtifactHash("invalid", undefined)).rejects.toThrow(
        "artifact hash not provided",
      );
    });

    it("computes hash from artifact.tar.gz in release dir", async () => {
      const releaseDir = path.join(tmpDir, "releases", "rel-001");
      await fs.mkdir(releaseDir, { recursive: true });
      const artifactPath = path.join(releaseDir, "artifact.tar.gz");
      await fs.writeFile(artifactPath, "test artifact content");
      const hash = await resolveArtifactHash(undefined, releaseDir);
      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe("makeR2ConfigFromEnv", () => {
    it("returns null when any required env var is missing", () => {
      expect(makeR2ConfigFromEnv({})).toBeNull();
      expect(makeR2ConfigFromEnv({ R2_ACCOUNT_ID: "a" })).toBeNull();
      expect(
        makeR2ConfigFromEnv({
          R2_ACCOUNT_ID: "a",
          R2_ACCESS_KEY_ID: "b",
          R2_SECRET_ACCESS_KEY: "c",
        }),
      ).toBeNull();
    });

    it("returns config when all env vars are present", () => {
      const config = makeR2ConfigFromEnv({
        R2_ACCOUNT_ID: "account",
        R2_ACCESS_KEY_ID: "key",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET_NAME: "bucket",
      });
      expect(config).toEqual({
        accountId: "account",
        accessKeyId: "key",
        secretAccessKey: "secret",
        bucketName: "bucket",
      });
    });
  });

  describe("authorizeAndDeploy", () => {
    it("authorizes when gate decision passes", async () => {
      const gateDecisionPath = path.join(tmpDir, "gate-decision.json");
      await fs.writeFile(gateDecisionPath, JSON.stringify(validGateDecision));

      const result = await authorizeAndDeploy({
        gateDecisionPath,
        artifactHash: testArtifactHash,
        candidateId: "test-candidate",
        gate: "dev-deploy",
        durableSyncVerified: false,
        artifactReadinessVerified: true,
        forceRequested: false,
        skipRequested: false,
        waiverRequested: false,
        graceRequested: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.outcome.authorized).toBe(true);
        expect(result.outcome.gate).toBe("dev-deploy");
        expect(result.outcome.channel).toBe("dev");
      }
    });

    it("fails when gate decision file is missing", async () => {
      await expect(
        authorizeAndDeploy({
          gateDecisionPath: path.join(tmpDir, "nonexistent.json"),
          artifactHash: testArtifactHash,
          candidateId: "test-candidate",
          gate: "dev-deploy",
          durableSyncVerified: false,
          artifactReadinessVerified: true,
          forceRequested: false,
          skipRequested: false,
          waiverRequested: false,
          graceRequested: false,
        }),
      ).rejects.toThrow("gate decision file not found");
    });
  });

  describe("buildEffectRecord", () => {
    it("creates a record with correct schema", () => {
      const record = buildEffectRecord(
        "op-001",
        "candidate-001",
        "dev-deploy",
        "dev",
        testArtifactHash,
        "dec-001",
        false,
        null,
        "authorized",
        "2026-01-01T00:00:00Z",
      );

      expect(record.schema).toBe("werkstatt/deployment-effect-record@1");
      expect(record.operationId).toBe("op-001");
      expect(record.candidateId).toBe("candidate-001");
      expect(record.gate).toBe("dev-deploy");
      expect(record.channel).toBe("dev");
      expect(record.artifactHash).toBe(testArtifactHash);
      expect(record.decisionId).toBe("dec-001");
      expect(record.durableSyncVerified).toBe(false);
      expect(record.mainVerificationDecisionId).toBeNull();
      expect(record.state).toBe("authorized");
      expect(record.effectHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe("writeDeploymentEffectRecord", () => {
    it("writes record to deployment-operations directory", async () => {
      const record = buildEffectRecord(
        "op-001",
        "candidate-001",
        "dev-deploy",
        "dev",
        testArtifactHash,
        "dec-001",
        false,
        null,
        "authorized",
        "2026-01-01T00:00:00Z",
      );

      const filePath = await writeDeploymentEffectRecord(tmpDir, record);
      expect(filePath).toContain("deployment-operations");
      expect(filePath).toContain("op-001.json");

      const content = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      expect(parsed.operationId).toBe("op-001");
    });
  });
});
