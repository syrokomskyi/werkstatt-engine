/*
<MODULE_CONTRACT>
<purpose>
Desired-state composition types for RFC-1038. Defines the declarative target
(DesiredState), the runtime actual state (ActualState, replacing KernelRegistry),
component/command/pipeline declarations, and the module export shape that
replaces KernelModule.register().
</purpose>
<non-goals>
  <item>Does not implement reconciliation logic — see reconciler.ts.</item>
  <item>Does not implement overlay resolution — see overlay.ts.</item>
  <item>Does not define Zod schemas — see component/schemas.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1038: initial implementation — desired-state composition types replacing ComponentManifestV1, KernelModule, KernelRegistry.</item>
</CHANGE_SUMMARY>
*/

import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type {
  CapabilityId,
  CapabilityProvideV1,
  CapabilityRequireV1,
  GrantRequestV1,
  EffectDeclarationV1,
  IsolationRequirementV1,
  ResourceBoundV1,
  ComponentScope,
  ScopeContext,
} from "../component/contracts.ts";
import type {
  KernelFlagSpec,
  GeneratedArtifactSpec,
  KernelPipelineStep,
  KernelCommandMetadata,
  KernelCommandInput,
  KernelRuntimeContext,
  KernelCommandResult,
  ModuleFiberState,
} from "../kernel/types.ts";

/**
 * Unified component type — replaces ComponentManifestV1.
 * Contains all manifest fields plus desired-state fields (config, priority, active).
 */
export interface ComponentDeclaration {
  schema: "werkstatt/component-declaration@1";
  /** Stable component ID — survives reconfiguration without losing identity. */
  componentId: `${string}/${string}`;
  version: string;
  artifactHash: Sha256Digest;
  scope: ComponentScope;
  provides: CapabilityProvideV1[];
  requires: CapabilityRequireV1[];
  requestedGrants: GrantRequestV1[];
  effects: EffectDeclarationV1[];
  isolation: IsolationRequirementV1;
  resources: ResourceBoundV1[];
  /** Configuration overrides for this component instance. */
  config?: Record<string, unknown>;
  /** Priority — higher priority components override lower for the same capability. */
  priority: number;
  /** Whether this component is desired to be active. */
  active: boolean;
}

export interface DesiredState {
  /** Stable component declarations keyed by componentId. Map for O(1) lookup. */
  components: Map<string, ComponentDeclaration>;
  /** Capability contracts that must be satisfied. */
  requiredCapabilities: string[];
  /** Available artifacts for resolution (from ResolutionInputV1, merged). */
  availableArtifacts: ReadonlyMap<string, Sha256Digest>;
  /** Admitted grants for resolution (from ResolutionInputV1, merged). */
  admittedGrants: ReadonlyArray<{ scope: string; resource: string }>;
  /** Profile ID for resolution (from ResolutionInputV1, merged). */
  profileId: string;
}

export interface ReconciliationDelta {
  /** Components to activate (present in desired, absent in actual). */
  toActivate: ComponentDeclaration[];
  /** Components to deactivate (absent in desired, present in actual). */
  toDeactivate: string[];
  /** Components to reconfigure (present in both, but config changed). */
  toReconfigure: Array<{
    id: string;
    oldConfig: Record<string, unknown>;
    newConfig: Record<string, unknown>;
  }>;
  /** Components unchanged (present in both, config identical). */
  unchanged: string[];
  /** Missing dependencies — required capabilities with no provider. */
  missingDependencies: Array<{ capability: string; requiredBy: string }>;
}

export interface ReconciliationResult {
  delta: ReconciliationDelta;
  applied: boolean;
  /** Components that failed to activate. */
  failures: Array<{ id: string; reason: string }>;
  /** Time taken to reconcile, in milliseconds. */
  durationMs: number;
}

/**
 * Command declaration — replaces KernelCommandDefinition for registration.
 * Carries ALL metadata fields from KernelCommandDefinition plus the execute function.
 * Type safety is preserved: execute receives typed KernelCommandInput and KernelRuntimeContext.
 */
export interface CommandDeclaration extends KernelCommandMetadata {
  /** Command name — e.g. "sternsystem.validate". */
  name: string;
  /** RFC-0260: declared flag schema. */
  flags?: Record<string, KernelFlagSpec>;
  /** RFC-0266: workspace-root-relative path globs this command reads. */
  reads?: string[];
  /** RFC-0266: workspace-root-relative path globs this command writes. */
  writes?: string[];
  /** RFC-0637: paths relative to module src/ for cache hashing. */
  modulePaths?: string[];
  /** RFC-0687: command names whose outputs this validator checks. */
  validatesOutputs?: string[];
  /** RFC-0960: repo-relative path to the implementing source file. */
  modulePath?: string;
  /** RFC-0960: declared generated artifacts. */
  generates?: GeneratedArtifactSpec[];
  /** RFC-0963: the single contract this validator enforces. */
  contract?: string;
  /** RFC-0963: the rule IDs this validator enforces. */
  rules?: string[];
  /** The execute function — typed, same signature as KernelCommandDefinition.execute. */
  execute: (
    input: KernelCommandInput,
    context: KernelRuntimeContext,
  ) => Promise<void | KernelCommandResult> | void | KernelCommandResult;
}

/**
 * Pipeline declaration — replaces registerPipeline() calls.
 * Carries the pipeline name and steps with all KernelPipelineStep fields.
 */
export interface PipelineDeclaration {
  /** Pipeline name — e.g. "packages.check". */
  name: string;
  /** Pipeline steps with command references, args, timeouts, and dependsOn (RFC-0686). */
  steps: KernelPipelineStep[];
}

/**
 * Module export — replaces KernelModule.
 * Each *.module.ts file exports this object instead of calling register().
 * The reconciler reads declarations, commands, and pipelines from this export.
 */
export interface ModuleExport {
  /** Module name — e.g. "sternsystem". */
  name: string;
  /** Module version. */
  version: string;
  /** Component declarations for desired-state composition. */
  declarations: ComponentDeclaration[];
  /**
   * Command declarations — replaces registerCommand() calls.
   * execute functions may lazy-load implementations via `await import()`
   * inside the execute body, preserving the current lazy-loading pattern.
   */
  commands: CommandDeclaration[];
  /** Pipeline declarations — replaces registerPipeline() calls. */
  pipelines: PipelineDeclaration[];
  /**
   * Optional conditional declaration builder.
   * Replaces conditional registration logic in register() bodies.
   * Receives the runtime context (env vars, profile, etc.) and returns
   * additional or modified declarations/commands/pipelines.
   * This runs at startup before reconciliation, not at registration time.
   */
  conditionalBuilder?: (context: ModuleBuildContext) => {
    declarations?: ComponentDeclaration[];
    commands?: CommandDeclaration[];
    pipelines?: PipelineDeclaration[];
  };
}

/**
 * Build context passed to conditionalBuilder.
 * Provides environment and profile information for conditional declarations.
 */
export interface ModuleBuildContext {
  /** Environment variables (process.env snapshot). */
  env: Record<string, string | undefined>;
  /** Profile ID from kernel config. */
  profileId: string;
  /** Whether this is a long-running process (dev server, watch mode). */
  longRunning: boolean;
}

/**
 * Actual state — replaces KernelRegistry entirely.
 * The desired state is the declarative target; the actual state is what's
 * currently running. The reconciler updates actual state to match desired state.
 * Command execution reads from actual state — no separate registry needed.
 *
 * Commands and pipelines are always available — they're the module's interface,
 * not dynamically activated. They're populated once at startup from ModuleExport[]
 * and never change. The reconciler only manages components (capabilities and effects).
 * A command may check component state at execution time if it depends on a capability.
 */
export interface ActualState {
  /** Active components with their runtime fiber state, keyed by componentId. */
  components: ReadonlyMap<string, { declaration: ComponentDeclaration; state: ModuleFiberState }>;
  /**
   * All declared commands from all ModuleExport[], keyed by command name.
   * Populated once at startup, never changes.
   */
  commands: ReadonlyMap<string, CommandDeclaration>;
  /**
   * All declared pipelines from all ModuleExport[], keyed by pipeline name.
   * Populated once at startup, never changes.
   */
  pipelines: ReadonlyMap<string, KernelPipelineStep[]>;
}

/**
 * Mutable version of ActualState — used by the reconciler for component mutations.
 * Commands and pipelines are still readonly (populated once at startup).
 */
export interface MutableActualState {
  components: Map<string, { declaration: ComponentDeclaration; state: ModuleFiberState }>;
  commands: ReadonlyMap<string, CommandDeclaration>;
  pipelines: ReadonlyMap<string, KernelPipelineStep[]>;
}

/**
 * Overlay — layered patch on the base desired state.
 * Allows scope-specific modifications without rewriting the base.
 */
export interface DesiredStateOverlay {
  /** Overlay ID — stable and unique within the scope. */
  id: string;
  /** Scope this overlay applies to (RFC-1036). */
  scope: ComponentScope;
  /** Scope context (e.g., missionId for per-mission overlays). */
  context: ScopeContext;
  /** Components to add or replace in the base desired state. */
  addOrReplace: Map<string, ComponentDeclaration>;
  /** Component IDs to remove from the base desired state. */
  remove: string[];
  /** Priority — higher priority overlays override lower ones. */
  priority: number;
}
