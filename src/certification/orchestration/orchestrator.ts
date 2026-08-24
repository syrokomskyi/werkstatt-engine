import type { GateChannel } from "../contracts/identifiers.ts";
import type { ReleaseCandidateV1 } from "../contracts/candidate.ts";
import type { CertificationPolicyBundleV1 } from "../contracts/policy-bundle.ts";
import type { CertificationProfileV1 } from "../profile/schemas.ts";
import type { EvidenceEnvelopeV1 } from "../contracts/evidence.ts";
import type { GateDecisionV1 } from "../contracts/decisions.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

export type OrchestratorState =
  | "idle"
  | "locked"
  | "planning"
  | "producing"
  | "ingesting"
  | "evaluating"
  | "syncing"
  | "completed"
  | "failed"
  | "cancelled";

export interface ProducerDependencyNodeV1 {
  producerId: string;
  dependsOn: string[];
}

export interface ProducerPlanV1 {
  ok: true;
  readonly batches: readonly (readonly string[])[];
  readonly producerIds: readonly string[];
}

export interface ProducerPlanFailureV1 {
  ok: false;
  ruleId: "CERT-ORCHESTRATOR-01" | "CERT-ORCHESTRATOR-02";
  message: string;
}

export type ProducerPlanOutcomeV1 = ProducerPlanV1 | ProducerPlanFailureV1;

export function planProducers(nodes: readonly ProducerDependencyNodeV1[]): ProducerPlanOutcomeV1 {
  const nodeMap = new Map<string, ProducerDependencyNodeV1>();
  for (const node of nodes) {
    if (nodeMap.has(node.producerId)) {
      return {
        ok: false,
        ruleId: "CERT-ORCHESTRATOR-01",
        message: `duplicate producerId "${node.producerId}" in dependency graph`,
      };
    }
    nodeMap.set(node.producerId, node);
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeMap.has(dep)) {
        return {
          ok: false,
          ruleId: "CERT-ORCHESTRATOR-02",
          message: `producer "${node.producerId}" depends on unknown producer "${dep}"`,
        };
      }
    }
  }

  const allIds = [...nodeMap.keys()];
  const sorted: string[] = [];
  const done = new Set<string>();
  const inProgress = new Set<string>();

  function topoSort(id: string): boolean {
    if (done.has(id)) return true;
    if (inProgress.has(id)) return false;
    inProgress.add(id);
    const node = nodeMap.get(id)!;
    for (const dep of node.dependsOn) {
      if (!topoSort(dep)) return false;
    }
    inProgress.delete(id);
    done.add(id);
    sorted.push(id);
    return true;
  }

  for (const id of allIds) {
    if (!topoSort(id)) {
      return {
        ok: false,
        ruleId: "CERT-ORCHESTRATOR-02",
        message: `cycle detected in producer dependency graph involving "${id}"`,
      };
    }
  }

  const levelMap = new Map<string, number>();
  for (const id of sorted) {
    const node = nodeMap.get(id)!;
    let maxDepLevel = -1;
    for (const dep of node.dependsOn) {
      const depLevel = levelMap.get(dep) ?? 0;
      if (depLevel > maxDepLevel) maxDepLevel = depLevel;
    }
    levelMap.set(id, maxDepLevel + 1);
  }

  const maxLevel = sorted.length > 0 ? Math.max(...[...levelMap.values()]) : -1;
  const batches: string[][] = [];
  for (let i = 0; i <= maxLevel; i++) {
    batches.push(sorted.filter((id) => levelMap.get(id) === i));
  }

  return {
    ok: true as const,
    batches,
    producerIds: sorted,
  };
}

export interface GateLockV1 {
  releaseId: string;
  gate: GateChannel;
  operationId: string;
  acquiredAt: string;
  holder: string;
}

export interface GateLockAcquireInputV1 {
  releaseId: string;
  gate: GateChannel;
  operationId: string;
  acquiredAt: string;
  holder: string;
}

export interface GateLockManagerV1 {
  acquire(input: GateLockAcquireInputV1): GateLockAcquireOutcomeV1;
  release(operationId: string): boolean;
  isLocked(releaseId: string, gate: GateChannel): boolean;
  getLock(releaseId: string, gate: GateChannel): GateLockV1 | null;
}

export interface GateLockAcquireResultV1 {
  ok: true;
  lock: GateLockV1;
}

export interface GateLockAcquireFailureV1 {
  ok: false;
  ruleId: "CERT-ORCHESTRATOR-03";
  message: string;
}

export type GateLockAcquireOutcomeV1 = GateLockAcquireResultV1 | GateLockAcquireFailureV1;

export function createGateLockManager(): GateLockManagerV1 {
  const locks = new Map<string, GateLockV1>();
  const key = (releaseId: string, gate: GateChannel) => `${releaseId}:${gate}`;

  return {
    acquire(input: GateLockAcquireInputV1): GateLockAcquireOutcomeV1 {
      const k = key(input.releaseId, input.gate);
      const existing = locks.get(k);
      if (existing && existing.operationId !== input.operationId) {
        return {
          ok: false,
          ruleId: "CERT-ORCHESTRATOR-03",
          message: `gate "${input.gate}" for release "${input.releaseId}" is already locked by operation "${existing.operationId}"`,
        };
      }
      const lock: GateLockV1 = {
        releaseId: input.releaseId,
        gate: input.gate,
        operationId: input.operationId,
        acquiredAt: input.acquiredAt,
        holder: input.holder,
      };
      locks.set(k, lock);
      return { ok: true, lock };
    },

    release(operationId: string): boolean {
      for (const [k, lock] of locks) {
        if (lock.operationId === operationId) {
          locks.delete(k);
          return true;
        }
      }
      return false;
    },

    isLocked(releaseId: string, gate: GateChannel): boolean {
      return locks.has(key(releaseId, gate));
    },

    getLock(releaseId: string, gate: GateChannel): GateLockV1 | null {
      return locks.get(key(releaseId, gate)) ?? null;
    },
  };
}

export interface ProducerExecutionConfigV1 {
  operationId: string;
  timestamp: string;
  maxParallelism: number;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export const DEFAULT_PRODUCER_CONFIG: Omit<ProducerExecutionConfigV1, "operationId" | "timestamp"> =
  {
    maxParallelism: 4,
    timeoutMs: 30000,
    maxRetries: 2,
    retryDelayMs: 1000,
  };

export interface ProducerExecutionInputV1 {
  producerId: string;
  candidate: ReleaseCandidateV1;
  profile: CertificationProfileV1;
  policyBundle: CertificationPolicyBundleV1;
  config: ProducerExecutionConfigV1;
}

export type ProducerExecutionHandlerV1 = (
  input: ProducerExecutionInputV1,
) => Promise<EvidenceEnvelopeV1>;

export interface ProgressEventV1 {
  operationId: string;
  producerId: string;
  status: "started" | "completed" | "failed" | "retried" | "cancelled" | "skipped";
  timestamp: string;
  attempt: number;
  detail?: string;
}

export type ProgressCallbackV1 = (event: ProgressEventV1) => void;

export interface ProducerExecutionResultV1 {
  ok: true;
  evidence: EvidenceEnvelopeV1[];
  events: ProgressEventV1[];
}

export interface ProducerExecutionFailureV1 {
  ok: false;
  ruleId: "CERT-ORCHESTRATOR-04" | "CERT-ORCHESTRATOR-05" | "CERT-ORCHESTRATOR-06";
  message: string;
  events: ProgressEventV1[];
  partialEvidence: EvidenceEnvelopeV1[];
}

export type ProducerExecutionOutcomeV1 = ProducerExecutionResultV1 | ProducerExecutionFailureV1;

export async function executeProducers(
  plan: ProducerPlanV1,
  handler: ProducerExecutionHandlerV1,
  baseInput: Omit<ProducerExecutionInputV1, "producerId">,
  onProgress?: ProgressCallbackV1,
): Promise<ProducerExecutionOutcomeV1> {
  const allEvidence: EvidenceEnvelopeV1[] = [];
  const events: ProgressEventV1[] = [];
  const timestamp = baseInput.config.timestamp;

  for (const batch of plan.batches) {
    const semaphore = new Semaphore(baseInput.config.maxParallelism);
    const batchResults = await Promise.allSettled(
      batch.map(async (producerId) => {
        const acquired = await semaphore.acquire();
        if (!acquired) {
          const event: ProgressEventV1 = {
            operationId: baseInput.config.operationId,
            producerId,
            status: "skipped",
            timestamp,
            attempt: 0,
          };
          events.push(event);
          onProgress?.(event);
          return null;
        }

        try {
          let lastError: Error | null = null;
          for (let attempt = 0; attempt <= baseInput.config.maxRetries; attempt++) {
            const startEvent: ProgressEventV1 = {
              operationId: baseInput.config.operationId,
              producerId,
              status: "started",
              timestamp,
              attempt,
            };
            events.push(startEvent);
            onProgress?.(startEvent);

            try {
              const evidence = await withTimeout(
                handler({ ...baseInput, producerId }),
                baseInput.config.timeoutMs,
              );
              const completeEvent: ProgressEventV1 = {
                operationId: baseInput.config.operationId,
                producerId,
                status: "completed",
                timestamp,
                attempt,
              };
              events.push(completeEvent);
              onProgress?.(completeEvent);
              return evidence;
            } catch (err) {
              lastError = err instanceof Error ? err : new Error(String(err));
              if (attempt < baseInput.config.maxRetries) {
                const retryEvent: ProgressEventV1 = {
                  operationId: baseInput.config.operationId,
                  producerId,
                  status: "retried",
                  timestamp,
                  attempt,
                  detail: lastError.message,
                };
                events.push(retryEvent);
                onProgress?.(retryEvent);
                await sleep(baseInput.config.retryDelayMs);
              }
            }
          }

          const failEvent: ProgressEventV1 = {
            operationId: baseInput.config.operationId,
            producerId,
            status: "failed",
            timestamp,
            attempt: baseInput.config.maxRetries,
            detail: lastError?.message ?? "unknown error",
          };
          events.push(failEvent);
          onProgress?.(failEvent);
          throw lastError ?? new Error("unknown error");
        } finally {
          semaphore.release();
        }
      }),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value !== null) {
        allEvidence.push(result.value);
      } else if (result.status === "rejected") {
        return {
          ok: false,
          ruleId: "CERT-ORCHESTRATOR-04",
          message: `producer execution failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          events,
          partialEvidence: allEvidence,
        };
      }
    }
  }

  return { ok: true, evidence: allEvidence, events };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    this.available = max;
  }

  async acquire(): Promise<boolean> {
    if (this.available > 0) {
      this.available--;
      return true;
    }
    return new Promise<boolean>((resolve) => {
      this.waiters.push(() => {
        this.available--;
        resolve(true);
      });
    });
  }

  release(): void {
    this.available++;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter();
    }
  }
}

export interface OrchestratorOperationV1 {
  operationId: string;
  releaseId: string;
  gate: GateChannel;
  candidate: ReleaseCandidateV1;
  profile: CertificationProfileV1;
  policyBundle: CertificationPolicyBundleV1;
  state: OrchestratorState;
  startedAt: string;
  resumePoint?: string;
  evidence: EvidenceEnvelopeV1[];
  decision?: GateDecisionV1;
  actionPackLocator?: string;
  dossierRootHash?: Sha256Digest;
}

export interface OrchestratorResumePointV1 {
  batchIndex: number;
  producerIdsCompleted: Set<string>;
}

export function createResumePoint(): OrchestratorResumePointV1 {
  return {
    batchIndex: 0,
    producerIdsCompleted: new Set(),
  };
}

export interface OrchestratorResumeResultV1 {
  ok: true;
  resumePoint: OrchestratorResumePointV1;
}

export interface OrchestratorResumeFailureV1 {
  ok: false;
  ruleId: "CERT-ORCHESTRATOR-07";
  message: string;
}

export type OrchestratorResumeOutcomeV1 = OrchestratorResumeResultV1 | OrchestratorResumeFailureV1;

export function computeResumePoint(
  operation: OrchestratorOperationV1,
  plan: ProducerPlanV1,
): OrchestratorResumeOutcomeV1 {
  const completed = new Set<string>();
  for (const ev of operation.evidence) {
    const producerId = ev.producerId;
    if (producerId) {
      completed.add(producerId);
    }
  }

  let batchIndex = 0;
  for (let i = 0; i < plan.batches.length; i++) {
    const batch = plan.batches[i];
    const allComplete = batch.every((id) => completed.has(id));
    if (!allComplete) {
      batchIndex = i;
      break;
    }
    batchIndex = i + 1;
  }

  if (batchIndex >= plan.batches.length && plan.batches.length > 0) {
    return {
      ok: false,
      ruleId: "CERT-ORCHESTRATOR-07",
      message: "all producer batches are already complete — nothing to resume",
    };
  }

  return {
    ok: true,
    resumePoint: { batchIndex, producerIdsCompleted: completed },
  };
}
