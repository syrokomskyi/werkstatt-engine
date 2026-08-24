/*
<MODULE_CONTRACT>
  <purpose>RFC-0867: test evidence reuse by artifact hash in leitstand.certify.</purpose>
  <keywords>RFC-0867, leitstand, certify, evidence, cache, reuse, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0867: initial tests for evidence reuse — same hash, different hash, --force, stale, missing sidecar.</item>
<item>Contract test: real evidence envelopes from runLeitstandCertify must pass evidenceEnvelopeV1Schema.safeParse — catches ID format mismatches that silently break reuse.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLeitstandCertify } from "../leitstand/certify.ts";
import { evidenceEnvelopeV1Schema } from "../certification/contracts/evidence.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";
import { vi } from "vitest";

vi.mock("../mission/mission-git-commit.ts", () => ({
  cacheCloneCommit: () => {},
}));

vi.mock("../werkstatt/git-exec.ts", () => ({
  gitExec: () => "",
}));

vi.mock("../certification/storage/r2-adapter.ts", () => ({
  createR2StorageAdapter: () => {
    throw new Error("R2 not configured in test");
  },
}));

const ARTIFACT_HASH = "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const DIFFERENT_HASH = "sha256:9999990123456789abcdef0123456789abcdef0123456789abcdef0123456789";

let tmpDir: string;
let cacheCloneDir: string;

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
    logger: {
      info: () => {},
      success: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  } as unknown as KernelRuntimeContext;
}

function writeGateDecision(dir: string, releaseId: string, gate: string, artifactHash: string) {
  const gateDecisionsDir = join(dir, "gate-decisions");
  mkdirSync(gateDecisionsDir, { recursive: true });
  const decision = {
    schema: "werkstatt/gate-decision@1",
    decisionId: `dec-existing-${gate}`,
    candidateId: "test-sys",
    policyBundleRoot: artifactHash,
    gate,
    evaluationCut: 1,
    selectedEvidence: [],
    status: "pass",
    coverage: {
      schema: "werkstatt/coverage-report@1",
      totalRequirements: 1,
      coveredRequirements: 1,
      uncoveredRequirements: [],
    },
    reasons: [],
    actionPackRef: null,
    decidedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(gateDecisionsDir, `${releaseId}-${gate}.json`),
    JSON.stringify(decision, null, 2) + "\n",
  );
}

function writeEvidenceSidecar(
  dir: string,
  releaseId: string,
  artifactHash: string,
  evidence: unknown[],
  producedByGate: string,
) {
  const gateDecisionsDir = join(dir, "gate-decisions");
  mkdirSync(gateDecisionsDir, { recursive: true });
  const sidecar = {
    schema: "werkstatt/evidence-cache@1",
    releaseId,
    artifactHash,
    evidence,
    producedAt: new Date().toISOString(),
    producedByGate,
  };
  writeFileSync(
    join(gateDecisionsDir, `${releaseId}-evidence.json`),
    JSON.stringify(sidecar, null, 2) + "\n",
  );
}

function makeFreshEvidence(): unknown[] {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  return [
    {
      schema: "werkstatt/evidence-envelope@1",
      evidenceId: "ev-test-001",
      candidateId: "test-sys",
      producerId: "astro-mission-check",
      producerAttemptId: "att-001",
      producedAt: new Date().toISOString(),
      result: {
        schema: "werkstatt/evidence-result@1",
        producerId: "astro-mission-check",
        producerAttemptId: "att-001",
        diagnostics: [],
        bindingHash: ARTIFACT_HASH,
        applicability: {
          appliesTo: [],
          scope: "site",
        },
      },
      payloads: [],
      redaction: {
        schema: "werkstatt/redaction-report@1",
        policyVersion: "1.0.0",
        detectedSecrets: 0,
        detectedPii: 0,
        resolved: true,
        unresolvedSecrets: 0,
        unresolvedPii: 0,
      },
      freshness: {
        expiresAt,
        staleAfter: expiresAt,
      },
    },
  ];
}

function makeStaleEvidence(): unknown[] {
  const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return [
    {
      schema: "werkstatt/evidence-envelope@1",
      evidenceId: "ev-test-stale",
      candidateId: "test-sys",
      producerId: "astro-mission-check",
      producerAttemptId: "att-stale",
      producedAt: pastDate,
      result: {
        schema: "werkstatt/evidence-result@1",
        producerId: "astro-mission-check",
        producerAttemptId: "att-stale",
        diagnostics: [],
        bindingHash: ARTIFACT_HASH,
        applicability: {
          appliesTo: [],
          scope: "site",
        },
      },
      payloads: [],
      redaction: {
        schema: "werkstatt/redaction-report@1",
        policyVersion: "1.0.0",
        detectedSecrets: 0,
        detectedPii: 0,
        resolved: true,
        unresolvedSecrets: 0,
        unresolvedPii: 0,
      },
      freshness: {
        expiresAt: pastDate,
        staleAfter: pastDate,
      },
    },
  ];
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "leitstand-0867-"));
  // resolveCacheClonePath resolves to path.resolve(workspaceRoot, "..", "systems-cache", systemId)
  // So workspaceRoot must be a subdirectory of tmpDir for the cache clone to be inside tmpDir
  const workspaceRoot = join(tmpDir, "werkstatt");
  mkdirSync(workspaceRoot, { recursive: true });
  cacheCloneDir = join(tmpDir, "systems-cache", "test-sys");
  mkdirSync(join(cacheCloneDir, "gate-decisions"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("same artifact hash → evidence reused (producers not executed)", async () => {
  const releaseId = "test-sys-r000001";
  writeGateDecision(cacheCloneDir, releaseId, "dev", ARTIFACT_HASH);
  writeEvidenceSidecar(cacheCloneDir, releaseId, ARTIFACT_HASH, makeFreshEvidence(), "dev");

  const infoSpy = vi.spyOn(console, "info");

  const input: KernelCommandInput = {
    flags: {
      site: "test-sys",
      gate: "alt",
      release: releaseId,
      "artifact-hash": ARTIFACT_HASH,
    },
    argv: [],
  };

  const result = await runLeitstandCertify(input, makeContext(join(tmpDir, "werkstatt")));

  expect(result.exitCode).toBe(0);
  expect(result.data!.producerCount).toBe(0);
  expect(result.data!.evidenceCount).toBeGreaterThan(0);
  expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("reusing evidence from dev gate"));
  infoSpy.mockRestore();
});

test("different artifact hash → producers execute", async () => {
  const releaseId = "test-sys-r000002";
  writeGateDecision(cacheCloneDir, releaseId, "dev", ARTIFACT_HASH);
  writeEvidenceSidecar(cacheCloneDir, releaseId, ARTIFACT_HASH, makeFreshEvidence(), "dev");

  const input: KernelCommandInput = {
    flags: {
      site: "test-sys",
      gate: "alt",
      release: releaseId,
      "artifact-hash": DIFFERENT_HASH,
    },
    argv: [],
  };

  const result = await runLeitstandCertify(input, makeContext(join(tmpDir, "werkstatt")));

  expect(result.exitCode).toBe(0);
  expect(result.data!.producerCount).toBe(1);
});

test("--force → producers execute even with matching hash", async () => {
  const releaseId = "test-sys-r000003";
  writeGateDecision(cacheCloneDir, releaseId, "dev", ARTIFACT_HASH);
  writeEvidenceSidecar(cacheCloneDir, releaseId, ARTIFACT_HASH, makeFreshEvidence(), "dev");

  const input: KernelCommandInput = {
    flags: {
      site: "test-sys",
      gate: "alt",
      release: releaseId,
      "artifact-hash": ARTIFACT_HASH,
      force: true,
    },
    argv: [],
  };

  const result = await runLeitstandCertify(input, makeContext(join(tmpDir, "werkstatt")));

  expect(result.exitCode).toBe(0);
  expect(result.data!.producerCount).toBe(1);
});

test("stale evidence → producers execute", async () => {
  const releaseId = "test-sys-r000004";
  writeGateDecision(cacheCloneDir, releaseId, "dev", ARTIFACT_HASH);
  writeEvidenceSidecar(cacheCloneDir, releaseId, ARTIFACT_HASH, makeStaleEvidence(), "dev");

  const input: KernelCommandInput = {
    flags: {
      site: "test-sys",
      gate: "alt",
      release: releaseId,
      "artifact-hash": ARTIFACT_HASH,
    },
    argv: [],
  };

  const result = await runLeitstandCertify(input, makeContext(join(tmpDir, "werkstatt")));

  expect(result.exitCode).toBe(0);
  expect(result.data!.producerCount).toBe(1);
});

test("missing evidence sidecar → producers execute (no error)", async () => {
  const releaseId = "test-sys-r000005";
  writeGateDecision(cacheCloneDir, releaseId, "dev", ARTIFACT_HASH);
  // No sidecar written

  const input: KernelCommandInput = {
    flags: {
      site: "test-sys",
      gate: "alt",
      release: releaseId,
      "artifact-hash": ARTIFACT_HASH,
    },
    argv: [],
  };

  const result = await runLeitstandCertify(input, makeContext(join(tmpDir, "werkstatt")));

  expect(result.exitCode).toBe(0);
  expect(result.data!.producerCount).toBe(1);
});

test("contract: real evidence envelopes pass evidenceEnvelopeV1Schema validation", async () => {
  const releaseId = "test-sys-r000006";
  // No prior gate decision, no baseUrl, no deployment-operations dir.
  // The handler will skip mission.check (warning branch) and produce
  // a real evidence envelope with the actual evidenceId format.

  const input: KernelCommandInput = {
    flags: {
      site: "test-sys",
      gate: "dev",
      release: releaseId,
      "artifact-hash": ARTIFACT_HASH,
    },
    argv: [],
  };

  const result = await runLeitstandCertify(input, makeContext(join(tmpDir, "werkstatt")));

  expect(result.exitCode).toBe(0);
  expect(result.data!.producerCount).toBe(1);

  // Read the evidence sidecar written by certify
  const sidecarPath = join(cacheCloneDir, "gate-decisions", `${releaseId}-evidence.json`);
  const sidecarRaw = JSON.parse(
    await import("node:fs/promises").then((m) => m.readFile(sidecarPath, "utf8")),
  );

  expect(sidecarRaw.schema).toBe("werkstatt/evidence-cache@1");
  expect(Array.isArray(sidecarRaw.evidence)).toBe(true);
  expect(sidecarRaw.evidence.length).toBeGreaterThan(0);

  // Validate each evidence envelope against the strict schema.
  // This is the contract test: if the handler generates IDs or fields
  // that don't match the schema, safeParse will fail here.
  for (const env of sidecarRaw.evidence) {
    const parsed = evidenceEnvelopeV1Schema.safeParse(env);
    if (!parsed.success) {
      throw new Error(
        `evidence envelope failed schema validation: ${JSON.stringify(parsed.error.issues.slice(0, 3))}\n` +
          `envelope: ${JSON.stringify({ evidenceId: env.evidenceId, schema: env.schema })}`,
      );
    }
  }
});
