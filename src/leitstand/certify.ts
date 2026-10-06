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
  <item>RECOVERY-2026-10-04: mission.check invocation now passes --channel=gateChannel — previously the flag was omitted, defaulting the suppression context to "main", so channelNot-scoped axiom suppressions (RFC-0684) never fired on dev/alt certifies. Gate channel is already validated to the same dev|alt|main enum.</item>
  <item>2026-10-04 recovery fix: mission.check timeouts raised to a shared 25min constant (was inner 5min race + outer 300s orchestrator timeout — a cold ~7-11min capture always exceeded both, racing a fail decision vs an "incomplete" no-decision return while abandoned mission.check processes kept running). Orchestrator timeout derives as +60s so the inner race still produces the diagnostic envelope deterministically.</item>
  <item>RFC-1190: restore mission context + evidence archival in release-mode deploys

RFC-1190: precedence-ordered resolveMissionContext (--mission → release build-identity → currentMission), MISSION_CONTEXT_UNRESOLVED/MISMATCH blocking, fail-closed EVIDENCE_SYNC_FAILED with --skip-evidence-sync as sole escape hatch, journaled evidence-sync-* ship steps after each certify-*, evidence.sync --site/--system flag.

2026-10-04 handoff fixes: shared 25min mission.check timeout (inner 5min race + 300s orchestrator raced cold ~7-11min captures), sweep excludeOpIds so mission.close no longer self-abandons the live ship journal (broke --resume), name-keyed journal resume state so closed-mission plan shifts can't skip unexecuted steps, wrangler dev documented as the required --base-url preview server.</item>
  <item>RECOVERY-2026-10-05: stale-channel detection — resolveDevDeploymentRecord captures the releaseId of the latest succeeded dev record; detectMeasuredReleaseMismatch flags when a remote (non---base-url) certify would measure a different artifact than the candidate. Upfront logger.warn, measured-release reason in the gate decision, and a fail-summary hint pointing at the --base-url recovery path (warpgogol r000028 dev gate measured stale r000027).</item>
  <item>RFC-1207: candidate-preview certify — wrangler dev on releases/<id>/dist/server measures the candidate artifact</item>
  <history>RECOVERY-2026, REVIEW-CODE-2026, RFC-0866, RFC-0867, RFC-0929, RFC-0938, RFC-1097, RFC-1126, RFC-1149</history>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  KernelCommandResult,
} from "@warpgogol/werkstatt-engine/kernel";
import { writeFileIfChanged } from "@warpgogol/werkstatt-engine/kernel";
import type { Sha256Digest } from "@warpgogol/werkstatt-shared/fingerprint";
import type {
  GateDecisionV1,
  MainVerificationDecisionV1,
} from "../certification/contracts/decisions.ts";
import type { GateChannel } from "../certification/contracts/identifiers.ts";
import type { DeploymentOperationState } from "../certification/state-machine.ts";
import { astroCertificationProfile } from "../certification/profile/astro-profile.ts";
import { makeR2ConfigFromEnv, resolveArtifactHash, flagSite } from "./deploy-helpers.ts";
import {
  provisionCandidatePreview,
  type CandidatePreview,
  type CertifyTarget,
} from "./candidate-preview.ts";
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
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

const PIN_DELETION_PROPAGATION_DELAY_MS = 5000;

// 2026-10-04 recovery fix: a cold mission.check (110+ captures, fresh evidence
// dir) takes ~7-11 minutes — the previous inner 5min race / outer 300s
// orchestrator timeout always expired mid-capture, racing a "timed out" fail
// decision against an "incomplete" no-decision return while the abandoned
// in-process mission.check kept running. 25min covers worst-case capture; the
// orchestrator timeout derives from it (+60s) so the inner race resolves first
// and still writes a diagnostic-bearing fail decision rather than no decision.
const MISSION_CHECK_TIMEOUT_MS = 25 * 60 * 1000;

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
  io: WorkspaceIO = createDefaultIO().io,
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
    entries = (await io.readdir(gateDecisionsDir)).map((e) => e.name);
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
      const content = await io.readFile(path.join(gateDecisionsDir, decisionFile));
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
      const sidecarContent = await io.readFile(path.join(gateDecisionsDir, sidecarFile));
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
  io: WorkspaceIO = createDefaultIO().io,
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
  await io.mkdir(outputDir);
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
  // RFC-1207: measurement-target provenance — which artifact the gate evaluated.
  measurementTarget?: "candidate-preview" | "channel" | "explicit";
  measuredReleaseId?: string;
  /** Candidate-preview identity. Present on every candidate-mode run; baseUrl/port only when a preview was actually provisioned (evidence-reuse runs skip the boot). */
  preview?: {
    artifactHash: string;
    baseUrl?: string;
    port?: number;
  };
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
  const {
    hash: artifactHash,
    source: artifactHashSource,
    path: artifactHashPath,
  } = await resolveArtifactHash(artifactHashFlag, releaseDir);
  context.logger.info(
    `[certify] artifact hash resolved from ${artifactHashSource}${artifactHashPath ? ` (${artifactHashPath})` : ""}: ${artifactHash}`,
  );

  const baseUrlFlag = flagString(input, "base-url");
  const gateChannel = gate as GateChannel;

  // RFC-1207: measurement target resolution — `--base-url` is the explicit
  // override (verbatim, unchanged); `--target channel` keeps the legacy
  // channel-measuring audit path; the default `candidate` mode provisions a
  // local `wrangler dev` preview of the candidate artifact inside certifyCore.
  const targetFlag = flagString(input, "target");
  if (targetFlag !== undefined && targetFlag !== "candidate" && targetFlag !== "channel") {
    throw new Error(
      `[leitstand.certify] --target must be "candidate" or "channel" (got: ${targetFlag})`,
    );
  }
  const certifyTarget: CertifyTarget = targetFlag === "channel" ? "channel" : "candidate";

  const cacheCloneDir = resolveCacheClonePath(context.workspaceRoot, systemId);
  const candidateServerDir = path.join(releaseDir, "dist", "server");

  // Candidate mode fails closed when the built artifact is missing — the
  // authorizing gate never silently measures the incumbent channel. The check
  // runs before PIN management so an absent artifact does not churn the access
  // PIN. Explicit --base-url and --target channel bypass it.
  if (!baseUrlFlag && certifyTarget === "candidate") {
    const earlyIo = context.io;
    if (!(await earlyIo.exists(candidateServerDir))) {
      const msg =
        `[leitstand.certify] candidate artifact missing: ${candidateServerDir} not found. ` +
        `The gate measures the candidate artifact through a local preview (RFC-1207) — build it first.`;
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
          measurementTarget: "candidate-preview",
          measuredReleaseId: releaseId,
        } as CertifyResult,
        summary: msg,
        exitCode: 2,
        nextSteps: [
          {
            action: `Build the release artifact: pnpm exec werkstatt run release.prepare --mission <mission-id>`,
            kind: "required",
          },
        ],
      } as unknown as KernelCommandResult<CertifyResult>;
    }
  }

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
    // Cloudflare Workers may retain the deleted secret for a few seconds.
    // Wait before running discovery to avoid 401 race condition.
    console.info(
      `[leitstand.certify] waiting ${PIN_DELETION_PROPAGATION_DELAY_MS / 1000}s for PIN deletion to propagate…`,
    );
    await new Promise((resolve) => setTimeout(resolve, PIN_DELETION_PROPAGATION_DELAY_MS));
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
  const certifyCore = async (
    io: WorkspaceIO = createDefaultIO().io,
  ): Promise<KernelCommandResult<CertifyResult>> => {
    // RFC-1207: resolve the measurement target inside certifyCore so the
    // preview lifecycle stays scoped to the evaluation. Explicit --base-url
    // wins verbatim; channel mode keeps the legacy deployment-record path;
    // candidate mode provisions wrangler dev lazily — only when producers
    // actually run (evidence reuse skips the boot entirely).
    let baseUrl: string | undefined;
    let measuredReleaseId: string | undefined;
    let measurementTarget: "candidate-preview" | "channel" | "explicit" | undefined;
    let measuredMismatch: string | null = null;
    let preview: CandidatePreview | null = null;

    if (baseUrlFlag) {
      baseUrl = baseUrlFlag;
      measurementTarget = "explicit";
    } else if (certifyTarget === "channel") {
      const resolvedBase = await resolveDevDeploymentRecord(cacheCloneDir, undefined);
      baseUrl = resolvedBase?.deploymentUrl;
      measuredReleaseId = resolvedBase?.releaseId;
      measurementTarget = "channel";
      // RECOVERY-2026-10-05: stale-channel detection. The gate crawls the
      // latest *succeeded dev* deployment record's URL — which may host a
      // different release than the candidate. Surface that upfront so a
      // misleading verdict self-explains instead of being chased as a
      // regression. Audit-only mode — ship never passes --target channel.
      measuredMismatch = detectMeasuredReleaseMismatch(undefined, measuredReleaseId, releaseId);
      if (measuredMismatch) {
        context.logger.warn(
          `[leitstand.certify] gate=${gate} measures the recorded dev deployment of ${measuredMismatch}, not candidate ${releaseId} — findings reflect the deployed channel artifact. ` +
            `For candidate-true certification serve the release artifact locally and pass --base-url (RECOVERY-2026-10-04).`,
        );
      }
    } else {
      measurementTarget = "candidate-preview";
      measuredReleaseId = releaseId;
    }

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
      io: WorkspaceIO = createDefaultIO().io,
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
            const identity = JSON.parse(await io.readFile(buildIdentityPath));
            missionId = identity.missionId;
          } catch {
            // build-identity.json not yet written or malformed — missionId unavailable
          }
          const argv = [
            `--site=${systemId}`,
            "--external-preview",
            `--base-url=${baseUrl}`,
            `--channel=${gateChannel}`,
            "--no-report",
          ];
          if (missionId) argv.push(`--mission=${missionId}`);
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
      // RFC-1207: candidate mode boots the preview only here — evidence-reuse
      // paths never spawn wrangler dev, and PIN-failure early returns precede
      // certifyCore entirely.
      if (measurementTarget === "candidate-preview") {
        try {
          preview = await provisionCandidatePreview({
            serverDir: candidateServerDir,
            releaseId,
            artifactHash,
            logger: context.logger,
          });
          baseUrl = preview.baseUrl;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
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
              measurementTarget,
              measuredReleaseId,
            } as CertifyResult,
            summary: `[leitstand.certify] candidate preview failed (infrastructure): ${msg}`,
            exitCode: 2,
            nextSteps: [
              {
                action: `Verify ${candidateServerDir} exists and wrangler is installed (pnpm exec wrangler --version), then re-run the gate`,
                kind: "required",
              },
            ],
          } as unknown as KernelCommandResult<CertifyResult>;
        }
      }

      try {
        const execResult = await executeProducers(plan, handler, {
          candidate,
          profile: astroCertificationProfile,
          policyBundle,
          config: {
            ...DEFAULT_PRODUCER_CONFIG,
            operationId,
            timestamp: now,
            timeoutMs: MISSION_CHECK_TIMEOUT_MS + 60_000,
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
              measurementTarget,
              measuredReleaseId,
            } as CertifyResult,
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
      } finally {
        // RFC-1207 (AC-7): preview teardown is finally-guaranteed — a failed
        // evaluation leaves no orphan wrangler dev. A crashed teardown warns
        // but does not flip the verdict.
        if (preview) {
          try {
            await preview.stop();
          } catch (stopErr) {
            context.logger.warn(
              `[leitstand.certify] candidate preview teardown failed: ${stopErr instanceof Error ? stopErr.message : String(stopErr)}`,
            );
          }
        }
      }
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
          measurementTarget,
          measuredReleaseId,
        } as CertifyResult,
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
      reasons: [
        ...evaluationResult.reasons,
        ...(measuredReleaseId
          ? [
              measuredMismatch
                ? `measured-release=${measuredReleaseId} differs from candidate=${releaseId} — gate evaluated the deployed channel artifact, not the candidate`
                : `measured-release=${measuredReleaseId}`,
            ]
          : []),
      ],
      actionPackRef: null,
      decidedAt: now,
      // RFC-1207 (AC-2): provenance persisted on the decision record itself —
      // not only the command result — so audits can tell which artifact the
      // verdict measured.
      measurementTarget,
      measuredReleaseId,
    };

    const outputDir = path.join(cacheCloneDir, "gate-decisions");
    await io.mkdir(outputDir);
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
        reasons: gateDecision.reasons,
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
      await gitExec(cacheCloneDir, `add ${relPath}`);
      if (sidecarExists) {
        await gitExec(cacheCloneDir, `add ${sidecarRelPath}`);
      }
      if (mainVerificationPath) {
        await gitExec(
          cacheCloneDir,
          `add ${path.join("gate-decisions", `${releaseId}-main-verification.json`)}`,
        );
      }
      await cacheCloneCommit(
        cacheCloneDir,
        `gate-decisions: ${releaseId}-${gate} (${gateDecision.status})`,
      );
      const branch = (await gitExec(cacheCloneDir, "rev-parse --abbrev-ref HEAD")).trim();
      await gitExec(cacheCloneDir, `push origin ${branch}`);
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
        measurementTarget,
        measuredReleaseId,
        // Preview identity rides every candidate-mode result — including
        // evidence-reuse runs that never booted a preview — so leitstand.ship
        // can journal candidatePreview.artifactHash for resume attribution.
        preview:
          measurementTarget === "candidate-preview"
            ? {
                artifactHash,
                ...(preview ? { baseUrl: preview.baseUrl, port: preview.port } : {}),
              }
            : undefined,
      },
      summary:
        `[leitstand.certify] gate=${gate} status=${evaluationResult.status} decision=${decisionId} output=${outputPath}` +
        (measuredMismatch && evaluationResult.status === "fail"
          ? ` — WARN: gate measured the deployed ${measuredMismatch} artifact, not candidate ${releaseId}; findings may be stale-channel state. Re-certify the candidate via --base-url (RECOVERY-2026-10-04), or deploy it first and re-run.`
          : ""),
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

export interface DevDeploymentRecord {
  deploymentUrl: string;
  releaseId?: string;
}

export async function resolveDevDeploymentRecord(
  cacheCloneDir: string,
  baseUrlFlag: string | undefined,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<DevDeploymentRecord | undefined> {
  if (baseUrlFlag) return { deploymentUrl: baseUrlFlag };

  const opsDir = path.join(cacheCloneDir, "deployment-operations");
  let latest: DevDeploymentRecord | undefined;
  try {
    const entries = await io.readdir(opsDir);
    let latestAt = "";
    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      try {
        const content = await io.readFile(path.join(opsDir, entry.name));
        const record = JSON.parse(content) as {
          channel?: string;
          state?: DeploymentOperationState;
          timestamp?: string;
          deploymentUrl?: string;
          releaseId?: string;
        };
        if (record.channel === "dev" && record.state === "succeeded" && record.deploymentUrl) {
          const at = record.timestamp ?? "";
          if (!latest || at > latestAt) {
            latestAt = at;
            latest = { deploymentUrl: record.deploymentUrl, releaseId: record.releaseId };
          }
        }
      } catch {
        // Skip malformed records
      }
    }
  } catch {
    // No deployment-operations directory yet
  }

  return latest;
}

export async function resolveDevBaseUrl(
  cacheCloneDir: string,
  baseUrlFlag: string | undefined,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string | undefined> {
  return (await resolveDevDeploymentRecord(cacheCloneDir, baseUrlFlag, io))?.deploymentUrl;
}

// RECOVERY-2026-10-05: stale-channel detection. A remote certify without
// --base-url measures whatever artifact the dev channel currently serves —
// which may be an older release than the candidate (poisoned channel: the
// gate's findings then belong to the deployed artifact, not the candidate).
// Returns the measured releaseId when it differs from the candidate, else null.
export function detectMeasuredReleaseMismatch(
  baseUrlFlag: string | undefined,
  measuredReleaseId: string | undefined,
  candidateReleaseId: string,
): string | null {
  if (baseUrlFlag || !measuredReleaseId || measuredReleaseId === candidateReleaseId) {
    return null;
  }
  return measuredReleaseId;
}
