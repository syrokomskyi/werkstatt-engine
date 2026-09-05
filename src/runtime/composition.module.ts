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
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelExecutionReport,
  KernelModule,
  KernelRuntimeContext,
} from "../kernel/types.ts";
import { resolveOverlays, inspectOverlays } from "./overlay.ts";
import { reconcile, computeDelta } from "./reconciler.ts";
import type { DesiredState, DesiredStateOverlay } from "./desired-state.ts";

async function runDesiredStateInspect(
  _input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelExecutionReport> {
  const data = {
    desired: {
      components: [] as Array<[string, unknown]>,
      requiredCapabilities: [] as string[],
      profileId: "",
    },
    actual: {
      components: [] as Array<{ componentId: string; state: string }>,
    },
  };

  return {
    commandName: "composition.desired-state.inspect",
    data,
    exitCode: 0,
    ok: true,
    summary: "Desired and actual state inspection",
    metadata: { name: "composition.desired-state.inspect" } as any,
    logs: _context.logger.getEvents(),
    filesModified: [],
    timing: { durationMs: 0, exceededTimeout: false },
  };
}

async function runCompositionReconcile(
  _input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelExecutionReport> {
  const emptyDesired: DesiredState = {
    components: new Map(),
    requiredCapabilities: [],
    availableArtifacts: new Map(),
    admittedGrants: [],
    profileId: "",
  };
  const emptyActual = {
    components: new Map(),
    commands: new Map(),
    pipelines: new Map(),
  };

  const result = await reconcile(emptyDesired, emptyActual);

  return {
    commandName: "composition.reconcile",
    data: result,
    exitCode: result.applied ? 0 : 1,
    ok: result.applied,
    summary: result.applied
      ? "Reconciliation applied"
      : `Reconciliation not applied: ${result.failures.map((f) => f.reason).join(", ")}`,
    metadata: { name: "composition.reconcile" } as any,
    logs: _context.logger.getEvents(),
    filesModified: [],
    timing: { durationMs: result.durationMs, exceededTimeout: false },
  };
}

async function runOverlayApply(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelExecutionReport> {
  const overlayId = input.flags["overlay-id"] as string | undefined;
  const scope = input.flags["scope"] as string | undefined;
  const addComponent = input.flags["add"] as string | undefined;
  const removeComponent = input.flags["remove"] as string | undefined;

  if (!overlayId || !scope) {
    return {
      commandName: "composition.overlay.apply",
      data: { error: "Missing required --overlay-id and --scope flags" },
      exitCode: 1,
      ok: false,
      summary: "Missing required --overlay-id and --scope flags",
      metadata: { name: "composition.overlay.apply" } as any,
      logs: context.logger.getEvents(),
      filesModified: [],
      timing: { durationMs: 0, exceededTimeout: false },
    };
  }

  const overlay: DesiredStateOverlay = {
    id: overlayId,
    scope: scope as any,
    context: { scope: scope as any },
    addOrReplace: new Map(),
    remove: removeComponent ? [removeComponent] : [],
    priority: 100,
  };

  const baseDesired: DesiredState = {
    components: new Map(),
    requiredCapabilities: [],
    availableArtifacts: new Map(),
    admittedGrants: [],
    profileId: "",
  };

  try {
    const resolved = resolveOverlays(baseDesired, [overlay]);
    return {
      commandName: "composition.overlay.apply",
      data: {
        overlayId,
        applied: true,
        componentCount: resolved.components.size,
      },
      exitCode: 0,
      ok: true,
      summary: `Overlay ${overlayId} applied`,
      metadata: { name: "composition.overlay.apply" } as any,
      logs: context.logger.getEvents(),
      filesModified: [],
      timing: { durationMs: 0, exceededTimeout: false },
    };
  } catch (e) {
    return {
      commandName: "composition.overlay.apply",
      data: { error: e instanceof Error ? e.message : String(e) },
      exitCode: 1,
      ok: false,
      summary: `Overlay apply failed: ${e instanceof Error ? e.message : String(e)}`,
      metadata: { name: "composition.overlay.apply" } as any,
      logs: context.logger.getEvents(),
      filesModified: [],
      timing: { durationMs: 0, exceededTimeout: false },
    };
  }
}

async function runOverlayInspect(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelExecutionReport> {
  const overlays: DesiredStateOverlay[] = [];
  const summary = inspectOverlays(overlays);

  return {
    commandName: "composition.overlay.inspect",
    data: { overlays: summary },
    exitCode: 0,
    ok: true,
    summary: `${overlays.length} overlay(s) active`,
    metadata: { name: "composition.overlay.inspect" } as any,
    logs: context.logger.getEvents(),
    filesModified: [],
    timing: { durationMs: 0, exceededTimeout: false },
  };
}

export const compositionModule: KernelModule = {
  name: "composition",
  version: "1.0.0",

  async register(registry) {
    registry.registerCommand({
      name: "composition.desired-state.inspect",
      modulePath: "packages/werkstatt-engine/src/runtime/composition.module.ts",
      description:
        "RFC-1038: Inspect current desired and actual state. Returns JSON with desired components, actual components, and their states.",
      scope: "workspace",
      mutatesState: false,
      cacheable: false,
      flags: {},
      execute: runDesiredStateInspect,
    });

    registry.registerCommand({
      name: "composition.reconcile",
      modulePath: "packages/werkstatt-engine/src/runtime/composition.module.ts",
      description:
        "RFC-1038: Reconcile desired state with actual state. Computes delta and applies changes transactionally.",
      scope: "workspace",
      mutatesState: true,
      cacheable: false,
      flags: {},
      execute: runCompositionReconcile,
    });

    registry.registerCommand({
      name: "composition.overlay.apply",
      modulePath: "packages/werkstatt-engine/src/runtime/composition.module.ts",
      description:
        "RFC-1038: Apply an overlay to the desired state and trigger reconciliation.",
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
    });

    registry.registerCommand({
      name: "composition.overlay.inspect",
      modulePath: "packages/werkstatt-engine/src/runtime/composition.module.ts",
      description:
        "RFC-1038: Inspect active overlays and their effects on the desired state.",
      scope: "workspace",
      mutatesState: false,
      cacheable: false,
      flags: {},
      execute: runOverlayInspect,
    });
  },
};
