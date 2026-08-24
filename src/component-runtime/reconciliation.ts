import type {
  ComponentId,
  ResolvedComponentSetV1,
  ResolvedComponentIdentityV1,
} from "../component/contracts.ts";
import { computeSetHash } from "../component/identity.ts";
import { resolve, type ResolutionInputV1 } from "./resolver.ts";
import { createActivationTransaction, type ActivationTransaction } from "./activation.ts";
import type { ComponentFiber } from "./fiber.ts";
import type { Deadline } from "./fiber.ts";

export interface ReconciliationPlanV1 {
  readonly schema: "werkstatt/reconciliation-plan@1";
  readonly currentSetHash: string;
  readonly desiredSetHash: string;
  readonly stopNewCalls: readonly ComponentId[];
  readonly drain: readonly ComponentId[];
  readonly unload: readonly ComponentId[];
  readonly load: readonly ComponentId[];
  readonly activate: readonly ComponentId[];
  readonly planHash: string;
}

export type ReconciliationResultV1 =
  | { status: "planned"; plan: ReconciliationPlanV1; desiredSet: ResolvedComponentSetV1 }
  | { status: "no-op"; currentSetHash: string }
  | { status: "blocked"; violations: import("./resolution-proof.ts").ResolutionViolationV1[] }
  | { status: "drift"; message: string };

export function computeReconciliationPlan(
  currentSet: ResolvedComponentSetV1 | null,
  desiredSet: ResolvedComponentSetV1,
): ReconciliationPlanV1 | { status: "no-op" } | { status: "drift"; message: string } {
  const currentHash = currentSet?.setHash ?? "sha256:" + "0".repeat(64);
  const desiredHash = desiredSet.setHash;

  if (currentHash === desiredHash) {
    return { status: "no-op" };
  }

  const currentComponents = new Map<ComponentId, ResolvedComponentIdentityV1>(
    (currentSet?.components ?? []).map((c) => [c.componentId, c] as const),
  );
  const desiredComponents = new Map<ComponentId, ResolvedComponentIdentityV1>(
    desiredSet.components.map((c) => [c.componentId, c] as const),
  );

  const stopNewCalls: ComponentId[] = [];
  const drain: ComponentId[] = [];
  const unload: ComponentId[] = [];
  const load: ComponentId[] = [];
  const activate: ComponentId[] = [];

  for (const [id] of currentComponents) {
    if (!desiredComponents.has(id)) {
      stopNewCalls.push(id);
      drain.push(id);
      unload.push(id);
    }
  }

  for (const [id] of desiredComponents) {
    if (!currentComponents.has(id)) {
      load.push(id);
      activate.push(id);
    }
  }

  for (const [id, desired] of desiredComponents) {
    const current = currentComponents.get(id);
    if (
      current &&
      (current.version !== desired.version || current.artifactHash !== desired.artifactHash)
    ) {
      stopNewCalls.push(id);
      drain.push(id);
      unload.push(id);
      load.push(id);
      activate.push(id);
    }
  }

  stopNewCalls.sort();
  drain.sort();
  unload.sort();
  load.sort();
  activate.sort();

  const planPayload = {
    schema: "werkstatt/reconciliation-plan@1",
    currentSetHash: currentHash,
    desiredSetHash: desiredHash,
    stopNewCalls,
    drain,
    unload,
    load,
    activate,
  };

  const planHash = computeSetHash({
    schema: "werkstatt/reconciliation-plan@1" as never,
    profileId: desiredSet.profileId,
    components: [],
    dependencyGraphHash: currentHash,
    grantSetHash: desiredHash,
    effectPolicyHash: planPayload.stopNewCalls.join(","),
    isolationPolicyHash: planPayload.activate.join(","),
  });

  return {
    schema: "werkstatt/reconciliation-plan@1",
    currentSetHash: currentHash,
    desiredSetHash: desiredHash,
    stopNewCalls,
    drain,
    unload,
    load,
    activate,
    planHash,
  };
}

export interface ReconcileOptions {
  readonly currentSet: ResolvedComponentSetV1 | null;
  readonly resolutionInput: ResolutionInputV1;
  readonly createFiber: (identity: ResolvedComponentIdentityV1) => ComponentFiber;
  readonly drainDeadline: Deadline;
  readonly transactionId: string;
}

export type ReconcileOutcome =
  | { status: "committed"; desiredSet: ResolvedComponentSetV1; transaction: ActivationTransaction }
  | { status: "no-op"; currentSetHash: string }
  | { status: "blocked"; violations: import("./resolution-proof.ts").ResolutionViolationV1[] }
  | { status: "aborted"; reason: string; transaction: ActivationTransaction }
  | { status: "quarantined"; reason: string; transaction: ActivationTransaction };

export function reconcile(options: ReconcileOptions): ReconcileOutcome | Promise<ReconcileOutcome> {
  const resolution = resolve(options.resolutionInput);

  if (resolution.status === "blocked") {
    return { status: "blocked", violations: resolution.violations };
  }

  const planResult = computeReconciliationPlan(options.currentSet, resolution.set);

  if ("status" in planResult && planResult.status === "no-op") {
    return {
      status: "no-op",
      currentSetHash: options.currentSet?.setHash ?? "sha256:" + "0".repeat(64),
    };
  }

  if ("status" in planResult && planResult.status === "drift") {
    return {
      status: "blocked",
      violations: [
        {
          code: "RESOLUTION-08" as never,
          componentId: null,
          capability: null,
          message: planResult.message,
        },
      ],
    };
  }

  const _plan = planResult as ReconciliationPlanV1;

  const tx = createActivationTransaction(
    options.transactionId,
    options.currentSet,
    resolution.set,
    options.createFiber,
    options.drainDeadline,
  );

  return tx
    .prepare()
    .then(() =>
      tx.commit().then(() => ({
        status: "committed" as const,
        desiredSet: resolution.set,
        transaction: tx,
      })),
    )
    .catch(() => {
      if (tx.isQuarantined) {
        return {
          status: "quarantined" as const,
          reason: tx.result.error ?? "unknown",
          transaction: tx,
        };
      }
      return { status: "aborted" as const, reason: tx.result.error ?? "unknown", transaction: tx };
    });
}
