/*
<MODULE_CONTRACT>
<purpose>RFC-0866: leitstand.certify command handler — produces GateDecisionV1 JSON via certification orchestration primitives.</purpose>
<non-goals>
  <item>Does not perform deployment — that is the responsibility of deploy-execution.ts.</item>
  <item>Does not define the GateDecisionV1 schema — that lives in certification/contracts/decisions.ts.</item>
  <item>Does not register the command — that lives in leitstand.module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-0866: initial certify module with CertifyInput, CertifyResult, and runLeitstandCertify().</item>
<item>RFC-0866 fix A-2/C-3: use writeFileIfChanged instead of fs.writeFile for gate-decision JSON.</item>
<item>RFC-0866 fix D-2: read dev deployment URL from effect records, accept --base-url flag fallback.</item>
<item>RFC-0866 audit: wire baseUrl into astro-mission-check producer handler — calls mission.check with --base-url when available, skips with warning when not.</item>
<item>Fix hardcoded systems-cache paths: use resolveCacheClonePath for gate-decisions output and resolveDevBaseUrl. Commit gate-decision JSON to cache clone git.</item>
<item>RFC-0867: add tryReuseEvidence — skip producer execution when prior gate evidence for same artifact hash is fresh. Write evidence sidecar {release}-evidence.json after producer execution.</item>
<item>RFC-0929: skip gate decisions with status=fail in tryReuseEvidence — only reuse evidence from passing decisions.</item>
<item>RFC-0929: add pre-flight accessPin check — fail early with clear message if site has PIN protection active. --force does not bypass this check.</item>
<item>RFC-0938: auto-manage access PIN during certify — auto-remove before producers, auto-restore in finally block. --auto-manage-pin flag (default true).</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import fs from "node:fs/promises";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  KernelCommandResult,
} from "@warpgogol/werkstatt-engine/kernel";
import { writeFileIfChanged } from "@warpgogol/werkstatt-engine/kernel";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type {
  GateDecisionV1,
  MainVerificationDecisionV1,
} from "../certification/contracts/decisions.ts";
import type { GateChannel } from "../certification/contracts/identifiers.ts";
import { astroCertificationProfile } from "../certification/profile/astro-profile.ts";
import { makeR2ConfigFromEnv, resolveArtifactHash, flagSite } from "./deploy-helpers.ts";
import { resolveCacheClonePath, readSystemStateSmart } from "../sternsystem/registry-io.ts";
import { cacheCloneCommit } from "../mission/mission-git-commit.ts";
import { gitExec } from "../werkstatt/git-exec.ts";
import { createR2StorageAdapter } from "../certification/storage/r2-adapter.ts";
import {
  planProducers,
  executeProducers,
  DEFAULT_PRODUCER_CONFIG,
  type ProducerDependencyNodeV1,
  type ProducerExecutionHandlerV1,
  type ProducerExecutionInputV1,
} from "../certification/orchestration/orchestrator.ts";
import { evaluateCertificationDecision } from "../certification/aggregation.ts";
import type { EvidenceEnvelopeV1 } from "../certification/contracts/evidence.ts";
import { evidenceEnvelopeV1Schema } from "../certification/contracts/evidence.ts";
import type { ReleaseCandidateV1 } from "../certification/contracts/candidate.ts";
import type { CertificationPolicyBundleV1 } from "../certification/contracts/policy-bundle.ts";
import { gateDecisionV1Schema } from "../certification/contracts/decisions.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBoolean(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

interface EvidenceCacheEntry {
  artifactHash: Sha256Digest;
  evidence: EvidenceEnvelopeV1[];
  producedAt: string;
  freshnessExpiresAt: string;
  sourceGate: GateChannel;
}

interface EvidenceCacheSidecar {
  schema: "werkstatt/evidence-cache@1";
  releaseId: string;
  artifactHash: Sha256Digest;
  evidence: EvidenceEnvelopeV1[];
  producedAt: string;
  producedByGate: GateChannel;
}

async function tryReuseEvidence(
  cacheCloneDir: string,
  releaseId: string,
  artifactHash: Sha256Digest,
  forceRequested: boolean,
): Promise<EvidenceCacheEntry | null> {
  // RFC-0867: The sequential deployment pipeline (dev → alt → main) uses the same
  // certification profile and policy bundle for all gates of a given release.
  // The artifact hash (policyBundleRoot) match is therefore sufficient to guarantee
  // that reused evidence satisfies the current gate's requirements. If the profile
  // or policy bundle changes between gates, a superseding RFC must add a profile-hash
  // check here.
  if (forceRequested) return null;

  const gateDecisionsDir = path.join(cacheCloneDir, "gate-decisions");
  let entries: string[];
  try {
    entries = await fs.readdir(gateDecisionsDir);
  } catch {
    return null;
  }

  const now = new Date();
  const gateSuffixes = ["dev", "alt", "main"];

  for (const gate of gateSuffixes) {
    const decisionFile = entries.find((e) => e === `${releaseId}-${gate}.json`);
    if (!decisionFile) continue;

    let decision: GateDecisionV1;
    try {
      const content = await fs.readFile(path.join(gateDecisionsDir, decisionFile), "utf8");
      const parsed = JSON.parse(content);
      const result = gateDecisionV1Schema.safeParse(parsed);
      if (!result.success) continue;
      decision = result.data;
    } catch {
      continue;
    }

    if (decision.status !== "pass") continue;
    if (decision.policyBundleRoot !== artifactHash) continue;

    const sidecarFile = entries.find((e) => e === `${releaseId}-evidence.json`);
    if (!sidecarFile) continue;

    let sidecar: EvidenceCacheSidecar;
    try {
      const sidecarContent = await fs.readFile(path.join(gateDecisionsDir, sidecarFile), "utf8");
      const sidecarParsed = JSON.parse(sidecarContent);
      if (
        sidecarParsed.schema !== "werkstatt/evidence-cache@1" ||
        sidecarParsed.artifactHash !== artifactHash ||
        !Array.isArray(sidecarParsed.evidence)
      ) {
        continue;
      }
      const validatedEvidence: EvidenceEnvelopeV1[] = [];
      for (const env of sidecarParsed.evidence) {
        const envResult = evidenceEnvelopeV1Schema.safeParse(env);
        if (!envResult.success) continue;
        validatedEvidence.push(envResult.data);
      }
      if (validatedEvidence.length === 0) continue;
      sidecar = {
        schema: sidecarParsed.schema,
        releaseId: sidecarParsed.releaseId,
        artifactHash: sidecarParsed.artifactHash,
        evidence: validatedEvidence,
        producedAt: sidecarParsed.producedAt,
        producedByGate: sidecarParsed.producedByGate,
      };
    } catch {
      continue;
    }

    const freshEvidence = sidecar.evidence.filter((env) => {
      if (!env.freshness?.expiresAt) return false;
      return new Date(env.freshness.expiresAt) > now;
    });

    if (freshEvidence.length === 0) continue;

    const earliestExpiry = freshEvidence.map((env) => env.freshness.expiresAt).sort()[0];

    return {
      artifactHash,
      evidence: freshEvidence,
      producedAt: sidecar.producedAt,
      freshnessExpiresAt: earliestExpiry,
      sourceGate: gate as GateChannel,
    };
  }

  return null;
}

async function writeEvidenceSidecar(
  cacheCloneDir: string,
  releaseId: string,
  artifactHash: Sha256Digest,
  evidence: EvidenceEnvelopeV1[],
  producedAt: string,
  producedByGate: GateChannel,
): Promise<string> {
  const sidecar: EvidenceCacheSidecar = {
    schema: "werkstatt/evidence-cache@1",
    releaseId,
    artifactHash,
    evidence,
    producedAt,
    producedByGate,
  };
  const outputDir = path.join(cacheCloneDir, "gate-decisions");
  await fs.mkdir(outputDir, { recursive: true });
  const sidecarPath = path.join(outputDir, `${releaseId}-evidence.json`);
  await writeFileIfChanged(sidecarPath, JSON.stringify(sidecar, null, 2) + "\n");
  return sidecarPath;
}

export interface CertifyInput {
  systemId: string;
  gate: "dev" | "alt" | "main";
  candidateId: string;
  artifactHash: Sha256Digest;
  releaseId: string;
}

export interface PinManagement {
  autoManaged: boolean;
  removedBefore: boolean;
  restoredAfter: boolean;
  restoreError: string | null;
}

export interface CertifyResult {
  command: "leitstand.certify";
  systemId: string;
  gate: string;
  decisionId: string;
  status: "pass" | "fail" | "stale" | "incomplete";
  outputPath: string;
  mainVerificationPath?: string;
  producerCount: number;
  evidenceCount: number;
  pinManagement?: PinManagement;
}

export async function runLeitstandCertify(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CertifyResult>> {
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[leitstand.certify] --site is required");
  const gate = flagString(input, "gate");
  if (!gate) throw new Error("[leitstand.certify] --gate is required (dev | alt | main)");
  if (!["dev", "alt", "main"].includes(gate)) {
    throw new Error(`[leitstand.certify] --gate must be dev, alt, or main (got: ${gate})`);
  }
  const candidateId = flagString(input, "candidate-id") ?? systemId;
  const artifactHashFlag = flagString(input, "artifact-hash");
  const releaseId = flagString(input, "release");
  if (!releaseId) throw new Error("[leitstand.certify] --release is required");

  const releaseDir = path.join(context.workspaceRoot, "releases", releaseId);
  const artifactHash = await resolveArtifactHash(artifactHashFlag, releaseDir);

  const baseUrlFlag = flagString(input, "base-url");
  const gateChannel = gate as GateChannel;

  const cacheCloneDir = resolveCacheClonePath(context.workspaceRoot, systemId);
  const baseUrl = await resolveDevBaseUrl(cacheCloneDir, baseUrlFlag);

  const forceRequested = flagBoolean(input, "force");

  // RFC-0938: Auto-manage access PIN. Default: true. When true, auto-remove PIN
  // before certification producers and restore it in a finally block. When false,
  // preserve RFC-0929 fail-early behavior.
  const autoManagePinRaw = input.flags["auto-manage-pin"];
  const autoManagePin = autoManagePinRaw === false || autoManagePinRaw === "false" ? false : true;

  const systemState = await readSystemStateSmart(context.workspaceRoot, systemId);
  const recordedPin = systemState.accessPin;

  let pinRemoved = false;
  let pinRestoreError: string | null = null;
  let pinRestored = false;

  if (recordedPin !== null && autoManagePin) {
    console.info(`[leitstand.certify] access PIN active — auto-removing for certification`);
    const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
    const unprotectResult = await executeKernelCommand({
      workspaceRoot: context.workspaceRoot,
      commandName: "leitstand.access.unprotect",
      argv: [`--site=${systemId}`],
    });
    const unprotectReports = Array.isArray(unprotectResult) ? unprotectResult : [unprotectResult];
    const unprotectFailed = unprotectReports.some(
      (r: { ok?: boolean; exitCode?: number }) => !r.ok || r.exitCode !== 0,
    );
    if (unprotectFailed) {
      const msg =
        `[leitstand.certify] failed to auto-remove access PIN for site '${systemId}'. ` +
        `The PIN is still active. Run: pnpm exec werkstatt run leitstand.access.unprotect --site ${systemId}`;
      return {
        data: {
          command: "leitstand.certify",
          systemId,
          gate,
          decisionId: "",
          status: "fail",
          outputPath: "",
          producerCount: 0,
          evidenceCount: 0,
          pinManagement: {
            autoManaged: true,
            removedBefore: false,
            restoredAfter: false,
            restoreError: null,
          },
        },
        summary: msg,
        exitCode: 1,
      } as unknown as KernelCommandResult<CertifyResult>;
    }
    pinRemoved = true;
  } else if (recordedPin !== null && !autoManagePin) {
    // RFC-0929: fail-early when auto-manage is disabled
    const msg =
      `[leitstand.certify] site '${systemId}' has access PIN protection active. ` +
      `Run: pnpm exec werkstatt run leitstand.access.unprotect --site ${systemId}`;
    return {
      data: {
        command: "leitstand.certify",
        systemId,
        gate,
        decisionId: "",
        status: "fail",
        outputPath: "",
        producerCount: 0,
        evidenceCount: 0,
        pinManagement: {
          autoManaged: false,
          removedBefore: false,
          restoredAfter: false,
          restoreError: null,
        },
      },
      summary: msg,
      exitCode: 1,
    } as unknown as KernelCommandResult<CertifyResult>;
  }

  // Inner function containing all certification logic. The try/finally wrapper
  // below ensures the PIN is restored even on early returns or thrown errors.
  const certifyCore = async (): Promise<KernelCommandResult<CertifyResult>> => {
    const reuseEntry = await tryReuseEvidence(
      cacheCloneDir,
      releaseId,
      artifactHash,
      forceRequested,
    );

    const producerNodes: ProducerDependencyNodeV1[] = [
      { producerId: "astro-mission-check", dependsOn: [] },
    ];

    const plan = planProducers(producerNodes);
    if (!plan.ok) {
      return {
        data: {
          command: "leitstand.certify",
          systemId,
          gate,
          decisionId: "",
          status: "incomplete",
          outputPath: "",
          producerCount: 0,
          evidenceCount: 0,
        },
        summary: `[leitstand.certify] producer planning failed: ${plan.ruleId} — ${plan.message}`,
        exitCode: 1,
        diagnostics: [
          { ruleId: plan.ruleId, severity: "error", message: plan.message, evidence: [] },
        ],
      } as unknown as KernelCommandResult<CertifyResult>;
    }

    const now = new Date().toISOString();
    const operationId = `certify-${now.toLowerCase().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;

    const candidate: ReleaseCandidateV1 = {
      schema: "werkstatt/release-candidate@1",
      candidateId,
      systemId,
      releaseVersion: releaseId,
      sourceHash: artifactHash,
      contentHash: artifactHash,
      artifactHash,
      buildConfig: {
        schema: "werkstatt/build-config@1",
        buildConfigHash: artifactHash,
        toolchainId: "astro",
        sourceRef: "src/content",
        contentHash: artifactHash,
      },
      deploymentPlan: {
        schema: "werkstatt/deployment-plan@1",
        deploymentPlanHash: artifactHash,
        channel: gateChannel,
        target: systemId,
        environmentRefs: [],
      },
      policyBundleRoot: artifactHash,
      toolchainId: "astro",
      observedEnvironment: {
        schema: "werkstatt/observed-environment@1",
        environment: "dev",
        environmentIdentityHash: artifactHash,
        observedAt: now,
      },
      observedAt: now,
    };

    const policyBundle: CertificationPolicyBundleV1 = {
      schema: "werkstatt/certification-policy-bundle@1",
      policyBundleId: "astro-default-bundle",
      version: "1.0.0",
      profileId: astroCertificationProfile.id,
      resolvedRequirements: astroCertificationProfile.requirements.map((req) => ({
        requirementId: req.id,
        source: "astro-certification-profile",
        description: req.title,
        mandatory: req.classification === "required",
      })),
      producerManifests: Object.values(astroCertificationProfile.producers).map((p) => ({
        schema: "werkstatt/producer-manifest@1",
        producerId: p.id,
        version: "1.0.0",
        capabilityId: p.id,
        schemaHash: artifactHash,
      })),
      rubricManifests: [],
      toolchainManifests: [],
      issuerManifests: [],
      riskPolicy: { maxStale: 0, maxIncomplete: 0, blockOnFail: true },
      retention: {
        minRetentionDays: astroCertificationProfile.retentionPolicy.minRetentionDays,
        maxRetentionDays: astroCertificationProfile.retentionPolicy.maxRetentionDays,
      },
      materializedAt: now,
    };

    const handler: ProducerExecutionHandlerV1 = async (
      execInput: ProducerExecutionInputV1,
    ): Promise<EvidenceEnvelopeV1> => {
      const evidenceId = `ev-${execInput.producerId}-${now.toLowerCase().replace(/[:.]/g, "-")}`;
      const diagnostics: Array<{
        ruleId: string;
        severity: "error" | "warning" | "info";
        message: string;
        evidence: Array<{ kind: "source" | "config" | "rule" | "rendered" | "cache" | "runtime" }>;
      }> = [];

      if (execInput.producerId === "astro-mission-check" && baseUrl) {
        try {
          const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
          let missionId: string | undefined;
          try {
            const buildIdentityPath = path.join(
              context.workspaceRoot,
              "releases",
              releaseId,
              "dist",
              "client",
              ".well-known",
              "build-identity.json",
            );
            const identity = JSON.parse(await fs.readFile(buildIdentityPath, "utf8"));
            missionId = identity.missionId;
          } catch {
            // build-identity.json not yet written or malformed — missionId unavailable
          }
          const argv = [
            `--site=${systemId}`,
            "--external-preview",
            `--base-url=${baseUrl}`,
            "--no-report",
          ];
          if (missionId) argv.push(`--mission=${missionId}`);
          const MISSION_CHECK_TIMEOUT_MS = 5 * 60 * 1000;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(`mission.check timed out after ${MISSION_CHECK_TIMEOUT_MS / 1000}s`),
                ),
              MISSION_CHECK_TIMEOUT_MS,
            );
          });
          try {
            const result = await Promise.race([
              executeKernelCommand({
                workspaceRoot: context.workspaceRoot,
                commandName: "mission.check",
                argv,
              }),
              timeoutPromise,
            ]);
            const reports = Array.isArray(result) ? result : [result];
            const failed = reports.find((r) => !r.ok || r.exitCode !== 0);
            if (failed) {
              diagnostics.push({
                ruleId: "MISSION-CHECK-01",
                severity: "error",
                message: `mission.check exited with code ${failed.exitCode}`,
                evidence: [],
              });
            } else {
              diagnostics.push({
                ruleId: "MISSION-CHECK-01",
                severity: "info",
                message: "mission.check passed",
                evidence: [],
              });
            }
          } finally {
            if (timer) clearTimeout(timer);
          }
        } catch (err) {
          diagnostics.push({
            ruleId: "MISSION-CHECK-01",
            severity: "error",
            message: `mission.check failed: ${err instanceof Error ? err.message : String(err)}`,
            evidence: [],
          });
        }
      } else if (execInput.producerId === "astro-mission-check" && !baseUrl) {
        diagnostics.push({
          ruleId: "MISSION-CHECK-01",
          severity: "warning",
          message:
            "mission.check skipped — no dev deployment URL available (first deploy or no open mission)",
          evidence: [],
        });
      }

      return {
        schema: "werkstatt/evidence-envelope@1",
        evidenceId,
        candidateId,
        producerId: execInput.producerId,
        producerAttemptId: `${operationId}-0`,
        producedAt: now,
        result: {
          schema: "werkstatt/evidence-result@1",
          producerId: execInput.producerId,
          producerAttemptId: `${operationId}-0`,
          diagnostics,
          bindingHash: artifactHash,
          applicability: {
            appliesTo: execInput.profile.requirements
              .filter((r) => r.producerId === execInput.producerId)
              .map((r) => r.id),
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
        authorityAdmission: {
          schema: "werkstatt/authority-admission@1",
          authoritySequence: 1,
          admittedAt: now,
          admittedBy: "leitstand.certify",
        },
        freshness: {
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          staleAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      };
    };

    let evidence: EvidenceEnvelopeV1[];
    let producerCount = producerNodes.length;

    if (reuseEntry) {
      console.info(
        `[leitstand.certify] reusing evidence from ${reuseEntry.sourceGate} gate (artifact hash match)`,
      );
      evidence = reuseEntry.evidence;
      producerCount = 0;
    } else {
      const execResult = await executeProducers(plan, handler, {
        candidate,
        profile: astroCertificationProfile,
        policyBundle,
        config: {
          ...DEFAULT_PRODUCER_CONFIG,
          operationId,
          timestamp: now,
          timeoutMs: 300000,
          maxRetries: 1,
        },
      });

      if (!execResult.ok) {
        return {
          data: {
            command: "leitstand.certify",
            systemId,
            gate,
            decisionId: "",
            status: "incomplete",
            outputPath: "",
            producerCount: producerNodes.length,
            evidenceCount: 0,
          },
          summary: `[leitstand.certify] producer execution failed: ${execResult.ruleId} — ${execResult.message}`,
          exitCode: 1,
          diagnostics: [
            {
              ruleId: execResult.ruleId,
              severity: "error",
              message: execResult.message,
              evidence: [],
            },
          ],
        } as unknown as KernelCommandResult<CertifyResult>;
      }

      evidence = execResult.evidence;

      await writeEvidenceSidecar(
        cacheCloneDir,
        releaseId,
        artifactHash,
        evidence,
        now,
        gateChannel,
      );
    }

    const evaluationResult = evaluateCertificationDecision({
      candidateId,
      policyBundle,
      evidence,
      evaluationCutSequence: 1,
      authorityTime: now,
      gate: gateChannel,
      decidedAt: now,
    });

    if (!evaluationResult.ok) {
      return {
        data: {
          command: "leitstand.certify",
          systemId,
          gate,
          decisionId: "",
          status: "incomplete",
          outputPath: "",
          producerCount: producerCount,
          evidenceCount: evidence.length,
        },
        summary: `[leitstand.certify] evaluation failed: ${evaluationResult.code} — ${evaluationResult.message}`,
        exitCode: 1,
        diagnostics: [
          {
            ruleId: evaluationResult.code,
            severity: "error",
            message: evaluationResult.message,
            evidence: [],
          },
        ],
      } as unknown as KernelCommandResult<CertifyResult>;
    }

    const decisionId = `dec-${now.toLowerCase().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
    const gateDecision: GateDecisionV1 = {
      schema: "werkstatt/gate-decision@1",
      decisionId,
      candidateId,
      policyBundleRoot: artifactHash,
      gate: gateChannel,
      evaluationCut: 1,
      selectedEvidence: evaluationResult.selectedEvidence.map((sel) => ({
        evidenceId: sel.evidenceId,
        evidenceHash: sel.evidenceHash,
        selectedAt: now,
      })),
      status: evaluationResult.status,
      coverage: evaluationResult.coverage,
      reasons: [...evaluationResult.reasons],
      actionPackRef: null,
      decidedAt: now,
    };

    const outputDir = path.join(cacheCloneDir, "gate-decisions");
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `${releaseId}-${gate}.json`);
    await writeFileIfChanged(outputPath, JSON.stringify(gateDecision, null, 2) + "\n");

    // When gate=main and status=pass, also write MainVerificationDecisionV1
    let mainVerificationPath: string | undefined;
    if (gate === "main" && evaluationResult.status === "pass") {
      const mvDecisionId = `dec-mv-${now.toLowerCase().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
      const mainVerification: MainVerificationDecisionV1 = {
        schema: "werkstatt/main-verification-decision@1",
        decisionId: mvDecisionId,
        candidateId,
        policyBundleRoot: artifactHash,
        gate: "main",
        evaluationCut: 1,
        selectedEvidence: gateDecision.selectedEvidence,
        status: "pass",
        coverage: evaluationResult.coverage,
        reasons: [...evaluationResult.reasons],
        actionPackRef: null,
        rootDossierRef: artifactHash,
        priorOperationRef: null,
        decidedAt: now,
      };
      mainVerificationPath = path.join(outputDir, `${releaseId}-main-verification.json`);
      await writeFileIfChanged(
        mainVerificationPath,
        JSON.stringify(mainVerification, null, 2) + "\n",
      );
    }

    const relPath = path.join("gate-decisions", `${releaseId}-${gate}.json`);
    const sidecarRelPath = path.join("gate-decisions", `${releaseId}-evidence.json`);
    const sidecarExists = !reuseEntry;
    try {
      gitExec(cacheCloneDir, `add ${relPath}`);
      if (sidecarExists) {
        gitExec(cacheCloneDir, `add ${sidecarRelPath}`);
      }
      if (mainVerificationPath) {
        gitExec(
          cacheCloneDir,
          `add ${path.join("gate-decisions", `${releaseId}-main-verification.json`)}`,
        );
      }
      cacheCloneCommit(
        cacheCloneDir,
        `gate-decisions: ${releaseId}-${gate} (${gateDecision.status})`,
      );
      const branch = gitExec(cacheCloneDir, "rev-parse --abbrev-ref HEAD").trim();
      gitExec(cacheCloneDir, `push origin ${branch}`);
    } catch {
      // Best-effort commit+push — file is written, sync will propagate later
    }

    const r2Config = makeR2ConfigFromEnv(process.env as Record<string, string | undefined>);
    if (r2Config) {
      try {
        const adapter = createR2StorageAdapter(r2Config);
        const gateDecisionBytes = Buffer.from(JSON.stringify(gateDecision, null, 2) + "\n", "utf8");
        await adapter.putObject({
          digest: artifactHash,
          bytes: new Uint8Array(gateDecisionBytes),
          mediaType: "application/json",
        });
      } catch (err) {
        console.warn(
          `[leitstand.certify] durable sync upload failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      data: {
        command: "leitstand.certify",
        systemId,
        gate,
        decisionId,
        status: evaluationResult.status,
        outputPath,
        mainVerificationPath,
        producerCount: producerCount,
        evidenceCount: evidence.length,
      },
      summary: `[leitstand.certify] gate=${gate} status=${evaluationResult.status} decision=${decisionId} output=${outputPath}`,
      exitCode: 0,
      nextSteps:
        evaluationResult.status === "pass"
          ? gate === "alt"
            ? [
                {
                  action: `Promote to main: pnpm exec werkstatt run leitstand.promote --site ${systemId} --release ${releaseId}`,
                  kind: "optional",
                },
              ]
            : [
                {
                  action: `Deployment pipeline complete. Close the mission: pnpm exec werkstatt run mission.close --mission <mission-id>`,
                  kind: "optional",
                },
              ]
          : [
              {
                action: `Review the evaluation failures in ${outputPath}, fix the issues, then re-run: pnpm exec werkstatt run leitstand.certify --release ${releaseId} --gate ${gate}`,
                kind: "required",
              },
            ],
    } as unknown as KernelCommandResult<CertifyResult>;
  }; // end certifyCore

  let result: KernelCommandResult<CertifyResult>;
  try {
    result = await certifyCore();
  } finally {
    if (pinRemoved) {
      console.info(`[leitstand.certify] restoring access PIN after certification`);
      try {
        const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
        const protectResult = await executeKernelCommand({
          workspaceRoot: context.workspaceRoot,
          commandName: "leitstand.access.protect",
          argv: [`--site=${systemId}`, `--pin=${recordedPin}`],
        });
        const protectReports = Array.isArray(protectResult) ? protectResult : [protectResult];
        const protectFailed = protectReports.some(
          (r: { ok?: boolean; exitCode?: number }) => !r.ok || r.exitCode !== 0,
        );
        if (protectFailed) {
          pinRestoreError = `PIN restore failed for site '${systemId}'`;
        } else {
          pinRestored = true;
        }
      } catch (err) {
        pinRestoreError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  // Post-finally: if PIN restore failed, override to hard fail (exitCode 1)
  if (pinRemoved && pinRestoreError !== null) {
    const msg =
      `[leitstand.certify] CRITICAL: access PIN restore failed: ${pinRestoreError}. ` +
      `Site '${systemId}' is UNPROTECTED. Run: pnpm exec werkstatt run leitstand.access.protect --site ${systemId} --pin ${recordedPin}`;
    return {
      data: {
        ...(result.data ?? {}),
        command: "leitstand.certify",
        systemId,
        gate,
        pinManagement: {
          autoManaged: true,
          removedBefore: true,
          restoredAfter: false,
          restoreError: pinRestoreError,
        },
      } as CertifyResult,
      summary: msg,
      exitCode: 1,
    } as unknown as KernelCommandResult<CertifyResult>;
  }

  // Attach pinManagement to the result for auto-manage paths
  if (autoManagePin && result.data) {
    (result.data as CertifyResult).pinManagement = {
      autoManaged: true,
      removedBefore: pinRemoved,
      restoredAfter: pinRestored,
      restoreError: null,
    };
  }

  return result;
}

async function resolveDevBaseUrl(
  cacheCloneDir: string,
  baseUrlFlag: string | undefined,
): Promise<string | undefined> {
  const opsDir = path.join(cacheCloneDir, "deployment-operations");
  let latestDevUrl: string | undefined;
  try {
    const entries = await fs.readdir(opsDir);
    let latestAt = "";
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const content = await fs.readFile(path.join(opsDir, entry), "utf8");
        const record = JSON.parse(content) as {
          channel?: string;
          timestamp?: string;
          deploymentUrl?: string;
        };
        if (record.channel === "dev" && record.deploymentUrl) {
          const at = record.timestamp ?? "";
          if (!latestDevUrl || at > latestAt) {
            latestAt = at;
            latestDevUrl = record.deploymentUrl;
          }
        }
      } catch {
        // Skip malformed records
      }
    }
  } catch {
    // No deployment-operations directory yet
  }

  if (latestDevUrl) return latestDevUrl;
  if (baseUrlFlag) return baseUrlFlag;
  return undefined;
}
