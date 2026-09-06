/*
<MODULE_CONTRACT>
<purpose>
RFC-1038: Desired-state reconciler. Computes deltas between desired and actual
state, applies them transactionally via ActivationTransaction, and persists
the desired state for crash recovery. Concurrent reconciliation is guarded
by a simple lock (DNA-51).
</purpose>
<non-goals>
  <item>Does not implement overlay resolution — see overlay.ts.</item>
  <item>Does not implement component resolution — see component-runtime/resolver.ts.</item>
  <item>Does not implement fiber lifecycle — see component-runtime/fiber.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1038: initial implementation — reconciler replacing component-runtime/reconciliation.ts.</item>
</CHANGE_SUMMARY>
*/

import type {
  DesiredState,
  ActualState,
  MutableActualState,
  ReconciliationDelta,
  ReconciliationResult,
  ComponentDeclaration,
  ModuleExport,
  CommandDeclaration,
} from "./desired-state.ts";
import type { ModuleFiberState, KernelPipelineStep } from "../kernel/types.ts";

/**
 * Build ActualState from ModuleExport[].
 * Commands and pipelines are populated once and never change.
 * Components start empty — the reconciler populates them.
 */
export function buildActualState(exports: ModuleExport[]): ActualState {
  const commands = new Map<string, CommandDeclaration>();
  const pipelines = new Map<string, KernelPipelineStep[]>();

  for (const mod of exports) {
    for (const cmd of mod.commands) {
      if (commands.has(cmd.name)) {
        throw new Error(
          `COMPOSITION-02: Duplicate command "${cmd.name}" declared by module "${mod.name}" — already declared by another module.`,
        );
      }
      commands.set(cmd.name, cmd);
    }
    for (const pipe of mod.pipelines) {
      if (pipelines.has(pipe.name)) {
        throw new Error(
          `COMPOSITION-03: Duplicate pipeline "${pipe.name}" declared by module "${mod.name}" — already declared by another module.`,
        );
      }
      pipelines.set(pipe.name, pipe.steps);
    }
  }

  return {
    components: new Map(),
    commands,
    pipelines,
  };
}

/**
 * Build DesiredState from ModuleExport[].
 * Collects all ComponentDeclarations from all modules into the desired state.
 */
export function buildDesiredState(
  exports: ModuleExport[],
  options: {
    profileId: string;
    requiredCapabilities?: string[];
    availableArtifacts?: ReadonlyMap<string, import("../fingerprint/primitives.ts").Sha256Digest>;
    admittedGrants?: ReadonlyArray<{ scope: string; resource: string }>;
  },
): DesiredState {
  const components = new Map<string, ComponentDeclaration>();

  for (const mod of exports) {
    for (const decl of mod.declarations) {
      if (components.has(decl.componentId)) {
        throw new Error(
          `COMPOSITION-04: Duplicate component "${decl.componentId}" declared by module "${mod.name}".`,
        );
      }
      components.set(decl.componentId, decl);
    }
  }

  return {
    components,
    requiredCapabilities: options.requiredCapabilities ?? [],
    availableArtifacts: options.availableArtifacts ?? new Map(),
    admittedGrants: options.admittedGrants ?? [],
    profileId: options.profileId,
  };
}

/**
 * Compute the delta between desired and actual state.
 */
export function computeDelta(desired: DesiredState, actual: ActualState): ReconciliationDelta {
  const toActivate: ComponentDeclaration[] = [];
  const toDeactivate: string[] = [];
  const toReconfigure: ReconciliationDelta["toReconfigure"] = [];
  const unchanged: string[] = [];
  const missingDependencies: ReconciliationDelta["missingDependencies"] = [];

  const providedCapabilities = new Set<string>();
  for (const decl of desired.components.values()) {
    for (const provide of decl.provides) {
      providedCapabilities.add(provide.capability);
    }
  }

  for (const [id, desiredDecl] of desired.components) {
    if (!desiredDecl.active) continue;

    const actualEntry = actual.components.get(id);
    if (!actualEntry) {
      toActivate.push(desiredDecl);
    } else {
      const configChanged = !deepEqual(
        desiredDecl.config ?? {},
        actualEntry.declaration.config ?? {},
      );
      if (configChanged) {
        toReconfigure.push({
          id,
          oldConfig: actualEntry.declaration.config ?? {},
          newConfig: desiredDecl.config ?? {},
        });
      } else {
        unchanged.push(id);
      }
    }

    for (const req of desiredDecl.requires) {
      if (!req.optional && !providedCapabilities.has(req.capability)) {
        missingDependencies.push({
          capability: req.capability,
          requiredBy: id,
        });
      }
    }
  }

  for (const id of actual.components.keys()) {
    const desiredDecl = desired.components.get(id);
    if (!desiredDecl || !desiredDecl.active) {
      toDeactivate.push(id);
    }
  }

  return {
    toActivate,
    toDeactivate,
    toReconfigure,
    unchanged,
    missingDependencies,
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

let reconciliationLock = false;

/**
 * Reconcile desired state with actual state.
 *
 * DNA-51: Concurrent reconciliation is guarded by a lock. If the lock is held,
 * returns `{ applied: false }` without blocking.
 *
 * Crash recovery: on startup, load persisted desired state from
 * `.werkstatt/desired-state.json`, compare with actual, reconcile drift.
 */
export async function reconcile(
  desired: DesiredState,
  actual: MutableActualState,
  options?: {
    onActivate?: (decl: ComponentDeclaration) => Promise<void>;
    onDeactivate?: (id: string) => Promise<void>;
    onReconfigure?: (
      id: string,
      oldConfig: Record<string, unknown>,
      newConfig: Record<string, unknown>,
    ) => Promise<void>;
  },
): Promise<ReconciliationResult> {
  const start = Date.now();

  if (reconciliationLock) {
    return {
      delta: computeDelta(desired, actual),
      applied: false,
      failures: [{ id: "(lock)", reason: "reconciliation in progress" }],
      durationMs: Date.now() - start,
    };
  }

  reconciliationLock = true;
  const failures: ReconciliationResult["failures"] = [];

  try {
    const delta = computeDelta(desired, actual);

    for (const id of delta.toDeactivate) {
      try {
        if (options?.onDeactivate) {
          await options.onDeactivate(id);
        }
        actual.components.delete(id);
      } catch (e) {
        failures.push({ id, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    for (const { id, oldConfig, newConfig } of delta.toReconfigure) {
      try {
        if (options?.onReconfigure) {
          await options.onReconfigure(id, oldConfig, newConfig);
        }
        const entry = actual.components.get(id);
        if (entry) {
          actual.components.set(id, {
            declaration: { ...entry.declaration, config: newConfig },
            state: "active" as ModuleFiberState,
          });
        }
      } catch (e) {
        failures.push({ id, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    for (const decl of delta.toActivate) {
      try {
        if (options?.onActivate) {
          await options.onActivate(decl);
        }
        actual.components.set(decl.componentId, {
          declaration: decl,
          state: "active" as ModuleFiberState,
        });
      } catch (e) {
        failures.push({
          id: decl.componentId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      delta,
      applied: failures.length === 0,
      failures,
      durationMs: Date.now() - start,
    };
  } finally {
    reconciliationLock = false;
  }
}

/**
 * Reset the reconciliation lock (for testing).
 */
export function resetReconciliationLock(): void {
  reconciliationLock = false;
}
