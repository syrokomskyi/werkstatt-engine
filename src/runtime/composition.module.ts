/*
<MODULE_CONTRACT>
<purpose>
RFC-1038: Registers composition.* commands for desired-state inspection,
reconciliation, and overlay management.
</purpose>
<non-goals>
  <item>Does not implement reconciliation logic — see runtime/reconciler.ts.</item>
  <item>Does not implement overlay resolution — see runtime/overlay.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1038: initial implementation — composition.desired-state.inspect, composition.reconcile, composition.overlay.apply, composition.overlay.inspect commands.</item>
  <item>RFC-1038 Phase 3: wire all commands to real actualState, desired state persistence, and overlay store.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelExecutionReport,
  KernelRuntimeContext,
} from "../kernel/types.ts";
import { resolveOverlays, inspectOverlays } from "./overlay.ts";
import { reconcile, reconcileFromPersisted } from "./reconciler.ts";
import { applyOverlay, getActiveOverlays, removeOverlay } from "./overlay-store.ts";
import { loadPersistedDesiredState } from "./desired-state-persistence.ts";
import type { DesiredStateOverlay, ModuleExport } from "./desired-state.ts";

function makeReport(
  commandName: string,
  data: unknown,
  ok: boolean,
  exitCode: number,
  summary: string,
  context: KernelRuntimeContext,
  durationMs: number,
): KernelExecutionReport {
  return {
    commandName,
    data,
    exitCode,
    ok,
    summary,
    metadata: { name: commandName } as any,
    logs: context.logger.getEvents(),
    filesModified: [],
    timing: { durationMs, exceededTimeout: false },
  };
}

async function runDesiredStateInspect(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelExecutionReport> {
  const start = Date.now();

  const desired = await loadPersistedDesiredState(context.workspaceRoot);
  const activeOverlays = getActiveOverlays();

  const effectiveDesired =
    desired && activeOverlays.length > 0 ? resolveOverlays(desired, activeOverlays) : desired;

  const data = {
    desired: effectiveDesired
      ? {
          components: Array.from(effectiveDesired.components.entries()) as Array<[string, unknown]>,
          requiredCapabilities: effectiveDesired.requiredCapabilities,
          profileId: effectiveDesired.profileId,
        }
      : null,
    actual: {
      components: Array.from(context.actualState.components.entries()).map(([id, entry]) => ({
        componentId: id,
        version: entry.declaration.version,
        state: entry.state,
      })),
    },
    overlays: inspectOverlays(activeOverlays),
  };

  return makeReport(
    "composition.desired-state.inspect",
    data,
    true,
    0,
    "Desired and actual state inspection",
    context,
    Date.now() - start,
  );
}

async function runCompositionReconcile(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelExecutionReport> {
  const start = Date.now();

  const result = await reconcileFromPersisted(
    context.workspaceRoot,
    [],
    context.actualState as any,
    { profileId: context.site?.name ?? "werkstatt" },
  );

  return makeReport(
    "composition.reconcile",
    result,
    result.applied,
    result.applied ? 0 : 1,
    result.applied
      ? "Reconciliation applied"
      : `Reconciliation not applied: ${result.failures.map((f) => f.reason).join(", ")}`,
    context,
    Date.now() - start,
  );
}

async function runOverlayApply(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelExecutionReport> {
  const start = Date.now();

  const overlayId = input.flags["overlay-id"] as string | undefined;
  const scope = input.flags["scope"] as string | undefined;
  const removeComponent = input.flags["remove"] as string | undefined;

  if (!overlayId || !scope) {
    return makeReport(
      "composition.overlay.apply",
      { error: "Missing required --overlay-id and --scope flags" },
      false,
      1,
      "Missing required --overlay-id and --scope flags",
      context,
      Date.now() - start,
    );
  }

  const overlay: DesiredStateOverlay = {
    id: overlayId,
    scope: scope as any,
    context: { scope: scope as any },
    addOrReplace: new Map(),
    remove: removeComponent ? [removeComponent] : [],
    priority: 100,
  };

  applyOverlay(overlay);

  try {
    const desired = await loadPersistedDesiredState(context.workspaceRoot);
    const activeOverlays = getActiveOverlays();
    const effectiveDesired = desired ? resolveOverlays(desired, activeOverlays) : null;

    let reconciliation: { applied: boolean; failures: Array<{ id: string; reason: string }> } = {
      applied: true,
      failures: [],
    };

    if (effectiveDesired) {
      const result = await reconcile(effectiveDesired, context.actualState as any);
      reconciliation = {
        applied: result.applied,
        failures: result.failures,
      };
    }

    return makeReport(
      "composition.overlay.apply",
      {
        overlayId,
        scope,
        applied: true,
        reconciliation,
        effectiveComponentCount: effectiveDesired?.components.size ?? 0,
      },
      true,
      0,
      `Overlay ${overlayId} applied`,
      context,
      Date.now() - start,
    );
  } catch (e) {
    removeOverlay(overlayId);
    return makeReport(
      "composition.overlay.apply",
      { error: e instanceof Error ? e.message : String(e) },
      false,
      1,
      `Overlay apply failed: ${e instanceof Error ? e.message : String(e)}`,
      context,
      Date.now() - start,
    );
  }
}

async function runOverlayInspect(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelExecutionReport> {
  const start = Date.now();

  const activeOverlays = getActiveOverlays();
  const summary = inspectOverlays(activeOverlays);

  const desired = await loadPersistedDesiredState(context.workspaceRoot);
  const effectiveDesired =
    desired && activeOverlays.length > 0 ? resolveOverlays(desired, activeOverlays) : desired;

  const data = {
    overlays: summary,
    effectiveDesiredState: effectiveDesired
      ? {
          componentCount: effectiveDesired.components.size,
          requiredCapabilities: effectiveDesired.requiredCapabilities,
          profileId: effectiveDesired.profileId,
        }
      : null,
  };

  return makeReport(
    "composition.overlay.inspect",
    data,
    true,
    0,
    `${activeOverlays.length} overlay(s) active`,
    context,
    Date.now() - start,
  );
}

export const compositionModule: ModuleExport = {
  name: "composition",
  version: "1.0.0",

  declarations: [],
  commands: [
    {
      name: "composition.desired-state.inspect",
      modulePath: "packages/werkstatt-engine/src/runtime/composition.module.ts",
      description:
        "RFC-1038: Inspect current desired and actual state. Returns JSON with desired components, actual components, and their states.",
      scope: "workspace",
      mutatesState: false,
      cacheable: false,
      flags: {},
      execute: runDesiredStateInspect,
    },
    {
      name: "composition.reconcile",
      modulePath: "packages/werkstatt-engine/src/runtime/composition.module.ts",
      description:
        "RFC-1038: Reconcile desired state with actual state. Computes delta and applies changes transactionally.",
      scope: "workspace",
      mutatesState: true,
      cacheable: false,
      flags: {},
      execute: runCompositionReconcile,
    },
    {
      name: "composition.overlay.apply",
      modulePath: "packages/werkstatt-engine/src/runtime/composition.module.ts",
      description: "RFC-1038: Apply an overlay to the desired state and trigger reconciliation.",
      scope: "workspace",
      mutatesState: true,
      cacheable: false,
      flags: {
        "overlay-id": {
          kind: "string",
          required: true,
          description: "Unique overlay ID.",
        },
        scope: {
          kind: "string",
          required: true,
          description: "Scope: per-command, per-mission, per-session, per-workshop, per-fleet.",
        },
        add: {
          kind: "string",
          description: "Component ID to add or replace.",
        },
        remove: {
          kind: "string",
          description: "Component ID to remove.",
        },
      },
      execute: runOverlayApply,
    },
    {
      name: "composition.overlay.inspect",
      modulePath: "packages/werkstatt-engine/src/runtime/composition.module.ts",
      description: "RFC-1038: Inspect active overlays and their effects on the desired state.",
      scope: "workspace",
      mutatesState: false,
      cacheable: false,
      flags: {},
      execute: runOverlayInspect,
    },
  ],
  pipelines: [],
};
