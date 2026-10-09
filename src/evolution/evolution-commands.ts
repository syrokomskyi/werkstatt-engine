/*
<MODULE_CONTRACT>
<purpose>RFC-1031: thin kernel command handlers for evolution.candidate.* commands.
  Each handler delegates to the evolution controller and wraps the result
  in KernelCommandResult. Records bordbuch candidate events on state transitions.</purpose>
<non-goals>
  <item>Does not implement evolution logic — all logic lives in controller.ts.</item>
  <item>Does not register commands — registration lives in evolution.module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1031: initial implementation — 9 evolution command handlers.</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";
import { createEvolutionController, type EvolutionControllerV1 } from "./controller.ts";
import type { CapabilityCandidateV1, CandidateEvidenceV1 } from "./contracts.ts";
import { appendBordbuchEntry } from "../bordbuch/bordbuch-io.ts";
import { byteHash } from "@warpgogol/werkstatt-shared/fingerprint";
import { applyOverlay, removeOverlay } from "../runtime/overlay-store.ts";
import { failResult } from "@warpgogol/werkstatt-shared/checks/result-helpers";

let controller: EvolutionControllerV1 | null = null;

function getController(): EvolutionControllerV1 {
  if (!controller) {
    controller = createEvolutionController();
  }
  return controller;
}

function flagString(input: KernelCommandInput, name: string): string {
  const v = input.flags[name];
  return typeof v === "string" ? v : "";
}

function flagBool(input: KernelCommandInput, name: string): boolean {
  return input.flags[name] === true;
}

function flagNumber(input: KernelCommandInput, name: string): number {
  const v = input.flags[name];
  return typeof v === "string" ? parseInt(v, 10) : 0;
}

const ZERO_HASH = `sha256:${"0".repeat(64)}` as never;

function emptySnapshot() {
  return {
    schema: "werkstatt/inspection-snapshot@1" as const,
    currentArtifactHash: ZERO_HASH,
    observedMetrics: [],
    activeIncidents: [],
    snapshotHash: ZERO_HASH,
  };
}

function makeIntent(intentId: string, description: string, scope: string) {
  return {
    schema: "werkstatt/bounded-intent@1" as const,
    intentId,
    description,
    scope,
    constraints: [],
    intentHash: byteHash(intentId) as never,
  };
}

function recordBordbuchCandidateEvent(
  context: KernelRuntimeContext,
  candidateId: string,
  stage: string,
  artifactHash: string,
): Promise<void> {
  const systemId = context.site?.name ?? "default";
  return appendBordbuchEntry(
    context.workspaceRoot,
    systemId,
    "candidate",
    `Candidate ${candidateId} transitioned to ${stage}`,
    "agent",
    {
      writerRole: "evolution",
      metadata: {
        candidateId,
        state: stage,
        artifactHash,
      },
    },
  )
    .then(() => undefined)
    .catch((err) => {
      context.logger.warn(`[evolution] Bordbuch candidate event failed: ${(err as Error).message}`);
    });
}

export async function runCandidateDefine(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ candidateId: string; stage: string }>> {
  const ctl = getController();
  const componentId = flagString(input, "component-id");
  const version = flagString(input, "version");
  const artifact = flagString(input, "artifact");
  const allowAgentWritten = flagBool(input, "allow-agent-written");

  if (!componentId || !version || !artifact) {
    return {
      ...failResult("evolution.commands", [
        "EVOLUTION-CMD-01: --component-id, --version, and --artifact are required",
      ]),
      data: { candidateId: "", stage: "" },
    };
  }

  const intent = makeIntent(
    `define-${componentId}`,
    `Define candidate for ${componentId}`,
    allowAgentWritten ? "agent-authored" : "human-authored",
  );
  const artifactHash = `sha256:${artifact.padEnd(64, "0").slice(0, 64)}` as never;
  const parentHash = `sha256:${"0".repeat(64)}` as never;
  const policyHash = `sha256:${"0".repeat(64)}` as never;

  const result = ctl.defineCandidate(
    emptySnapshot(),
    intent,
    artifactHash,
    parentHash,
    policyHash,
    componentId,
    version,
    "",
    allowAgentWritten,
  );

  if (!result.ok) {
    return {
      ...failResult("evolution.commands", [`${result.ruleId}: ${result.message}`]),
      data: { candidateId: "", stage: "" },
    };
  }

  await recordBordbuchCandidateEvent(
    context,
    result.candidate.candidateId,
    result.candidate.stage,
    result.candidate.artifactHash,
  );

  return {
    data: { candidateId: result.candidate.candidateId, stage: result.candidate.stage },
    exitCode: 0,
    summary: `[evolution.commands] Candidate ${result.candidate.candidateId} defined in stage ${result.candidate.stage}`,
  };
}

export async function runCandidateShadow(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ evidence: CandidateEvidenceV1 | null }>> {
  const ctl = getController();
  const candidateId = flagString(input, "candidate-id");
  const metric = flagString(input, "metric") || "latency";

  if (!candidateId) {
    return {
      ...failResult("evolution.commands", ["EVOLUTION-CMD-02: --candidate-id is required"]),
      data: { evidence: null },
    };
  }

  try {
    const evidence = await ctl.shadow(candidateId, metric);
    const candidate = ctl.getCandidate(candidateId);
    await recordBordbuchCandidateEvent(
      context,
      candidateId,
      "shadowing",
      candidate?.artifactHash ?? "",
    );
    return {
      data: { evidence },
      exitCode: 0,
      summary: `[evolution.commands] Shadow execution completed for candidate ${candidateId}`,
    };
  } catch (err) {
    return {
      ...failResult("evolution.commands", [`Shadow execution failed: ${(err as Error).message}`]),
      data: { evidence: null },
    };
  }
}

export async function runCandidateTest(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ evidenceCount: number }>> {
  const ctl = getController();
  const candidateId = flagString(input, "candidate-id");
  const scenarios = flagString(input, "scenarios") || "src/evolution/fixtures";

  if (!candidateId) {
    return {
      ...failResult("evolution.commands", ["EVOLUTION-CMD-03: --candidate-id is required"]),
      data: { evidenceCount: 0 },
    };
  }

  try {
    const evidence = await ctl.test(candidateId, scenarios);
    const candidate = ctl.getCandidate(candidateId);
    await recordBordbuchCandidateEvent(
      context,
      candidateId,
      "testing",
      candidate?.artifactHash ?? "",
    );
    return {
      data: { evidenceCount: evidence.length },
      exitCode: 0,
      summary: `[evolution.commands] Test execution completed for candidate ${candidateId} (${evidence.length} scenarios)`,
    };
  } catch (err) {
    return {
      ...failResult("evolution.commands", [`Test execution failed: ${(err as Error).message}`]),
      data: { evidenceCount: 0 },
    };
  }
}

export async function runCandidateCanary(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ trafficPercent: number }>> {
  const ctl = getController();
  const candidateId = flagString(input, "candidate-id");
  const trafficPercent = flagNumber(input, "traffic-percent") || 10;

  if (!candidateId) {
    return {
      ...failResult("evolution.commands", ["EVOLUTION-CMD-04: --candidate-id is required"]),
      data: { trafficPercent: 0 },
    };
  }

  try {
    await ctl.canary(candidateId, trafficPercent);
    const candidate = ctl.getCandidate(candidateId);
    await recordBordbuchCandidateEvent(
      context,
      candidateId,
      "canary",
      candidate?.artifactHash ?? "",
    );
    return {
      data: { trafficPercent },
      exitCode: 0,
      summary: `[evolution.commands] Canary routing at ${trafficPercent}% for candidate ${candidateId}`,
    };
  } catch (err) {
    return {
      ...failResult("evolution.commands", [`Canary activation failed: ${(err as Error).message}`]),
      data: { trafficPercent: 0 },
    };
  }
}

export async function runCandidateActivate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ candidateId: string; stage: string }>> {
  const ctl = getController();
  const candidateId = flagString(input, "candidate-id");

  if (!candidateId) {
    return {
      ...failResult("evolution.commands", ["EVOLUTION-CMD-05: --candidate-id is required"]),
      data: { candidateId: "", stage: "" },
    };
  }

  try {
    await ctl.activate(candidateId);
    const candidate = ctl.getCandidate(candidateId);
    applyOverlay({
      id: `evolution-${candidateId}`,
      scope: "per-workshop",
      context: { scope: "per-workshop" },
      addOrReplace: new Map(),
      remove: [],
      priority: 200,
    });
    await recordBordbuchCandidateEvent(
      context,
      candidateId,
      "active",
      candidate?.artifactHash ?? "",
    );
    return {
      data: { candidateId, stage: "active" },
      exitCode: 0,
      summary: `[evolution.commands] Candidate ${candidateId} activated`,
    };
  } catch (err) {
    return {
      ...failResult("evolution.commands", [`Activation failed: ${(err as Error).message}`]),
      data: { candidateId, stage: "" },
    };
  }
}

export async function runCandidatePromote(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ missionId: string; stage: string }>> {
  const ctl = getController();
  const candidateId = flagString(input, "candidate-id");
  const missionId = flagString(input, "mission-id");

  if (!candidateId || !missionId) {
    return {
      ...failResult("evolution.commands", [
        "EVOLUTION-CMD-06: --candidate-id and --mission-id are required",
      ]),
      data: { missionId: "", stage: "" },
    };
  }

  try {
    await ctl.promote(candidateId, missionId);
    const candidate = ctl.getCandidate(candidateId);
    await recordBordbuchCandidateEvent(
      context,
      candidateId,
      "promoted",
      candidate?.artifactHash ?? "",
    );
    return {
      data: { missionId, stage: "promoted" },
      exitCode: 0,
      summary: `[evolution.commands] Candidate ${candidateId} promoted via mission ${missionId}`,
    };
  } catch (err) {
    return {
      ...failResult("evolution.commands", [`Promotion failed: ${(err as Error).message}`]),
      data: { missionId, stage: "" },
    };
  }
}

export async function runCandidateRollback(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ componentId: string; stage: string }>> {
  const ctl = getController();
  const componentId = flagString(input, "component-id");

  if (!componentId) {
    return {
      ...failResult("evolution.commands", ["EVOLUTION-CMD-07: --component-id is required"]),
      data: { componentId: "", stage: "" },
    };
  }

  try {
    await ctl.rollback(componentId);
    removeOverlay(`evolution-${componentId}`);
    await recordBordbuchCandidateEvent(context, componentId, "rolled-back", "");
    return {
      data: { componentId, stage: "rolled-back" },
      exitCode: 0,
      summary: `[evolution.commands] Component ${componentId} rolled back`,
    };
  } catch (err) {
    return {
      ...failResult("evolution.commands", [`Rollback failed: ${(err as Error).message}`]),
      data: { componentId, stage: "" },
    };
  }
}

export async function runCandidateQuarantine(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ candidateId: string; stage: string; reason: string }>> {
  const ctl = getController();
  const candidateId = flagString(input, "candidate-id");
  const reason = flagString(input, "reason") || "unspecified";

  if (!candidateId) {
    return {
      ...failResult("evolution.commands", ["EVOLUTION-CMD-08: --candidate-id is required"]),
      data: { candidateId: "", stage: "", reason: "" },
    };
  }

  try {
    await ctl.quarantine(candidateId, reason);
    const candidate = ctl.getCandidate(candidateId);
    await recordBordbuchCandidateEvent(
      context,
      candidateId,
      "quarantined",
      candidate?.artifactHash ?? "",
    );
    return {
      data: { candidateId, stage: "quarantined", reason },
      exitCode: 0,
      summary: `[evolution.commands] Candidate ${candidateId} quarantined: ${reason}`,
    };
  } catch (err) {
    return {
      ...failResult("evolution.commands", [`Quarantine failed: ${(err as Error).message}`]),
      data: { candidateId, stage: "", reason },
    };
  }
}

export async function runCandidateInspect(
  _input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ candidates: readonly CapabilityCandidateV1[] }>> {
  const ctl = getController();
  const candidates = ctl.inspectAll();
  return {
    data: { candidates },
    exitCode: 0,
    summary: `[evolution.commands] ${candidates.length} candidate(s) registered`,
  };
}
