import type {
  CapabilityId,
  CapabilityProvideV1,
  CapabilityRequireV1,
  ComponentId,
  ComponentManifestV1,
  EffectDeclarationV1,
  GrantRequestV1,
  ResolvedComponentSetV1,
} from "../component/contracts.ts";
import type { ComponentLifecycleState } from "./lifecycle.ts";
import { computeSetHash } from "../component/identity.ts";

export type ReflectedLifecycleState = "waiting" | "active" | "draining" | "failed" | "quarantined";

export interface CapabilityCatalogEntryV1 {
  readonly capability: CapabilityId;
  readonly version: string;
  readonly schemaHash: string;
  readonly componentId: ComponentId;
  readonly lifecycleState: ReflectedLifecycleState;
  readonly callable: boolean;
}

export interface CapabilityCatalogV1 {
  readonly schema: "werkstatt/capability-catalog@1";
  readonly observedAt: string;
  readonly resolvedComponentSetHash: string;
  readonly entries: readonly CapabilityCatalogEntryV1[];
  readonly catalogHash: string;
}

export interface LiveComponentObservation {
  readonly componentId: ComponentId;
  readonly lifecycleState: ComponentLifecycleState;
}

export interface ReflectionInput {
  readonly activeSet: ResolvedComponentSetV1;
  readonly manifests: ReadonlyMap<ComponentId, ComponentManifestV1>;
  readonly observations: ReadonlyMap<ComponentId, LiveComponentObservation>;
  readonly observedAt?: string;
  readonly visibleCapabilities?: ReadonlySet<CapabilityId>;
}

const FORBIDDEN_FIELDS = new Set([
  "secrets",
  "credentials",
  "privateState",
  "rawGrants",
  "prompts",
  "executableBytes",
  "leaseTokens",
  "authorityMaterial",
  "artifactBytes",
  "sourceCode",
]);

export function toReflectedState(state: ComponentLifecycleState): ReflectedLifecycleState {
  switch (state) {
    case "waiting":
    case "active":
    case "draining":
    case "failed":
    case "quarantined":
      return state;
    case "declared":
    case "loading":
      return "waiting";
    case "unloading":
      return "draining";
    case "disposed":
      return "failed";
    default:
      return "failed";
  }
}

function isCallable(state: ReflectedLifecycleState): boolean {
  return state === "active";
}

function computeCatalogHash(
  observedAt: string,
  resolvedComponentSetHash: string,
  entries: readonly CapabilityCatalogEntryV1[],
): string {
  const payload = {
    schema: "werkstatt/capability-catalog@1",
    observedAt,
    resolvedComponentSetHash,
    entries: entries.map((e) => ({
      capability: e.capability,
      version: e.version,
      schemaHash: e.schemaHash,
      componentId: e.componentId,
      lifecycleState: e.lifecycleState,
      callable: e.callable,
    })),
  };
  return computeSetHash({
    schema: "werkstatt/capability-catalog@1" as never,
    profileId: "reflection",
    components: [],
    dependencyGraphHash: resolvedComponentSetHash,
    grantSetHash: observedAt,
    effectPolicyHash: payload.entries.map((e) => e.capability).join(","),
    isolationPolicyHash: payload.entries.map((e) => e.componentId).join(","),
  });
}

export function createCapabilityCatalog(input: ReflectionInput): CapabilityCatalogV1 {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const activeSetHash = input.activeSet.setHash;

  const recomputedHash = computeSetHash({
    schema: input.activeSet.schema,
    profileId: input.activeSet.profileId,
    components: input.activeSet.components,
    dependencyGraphHash: input.activeSet.dependencyGraphHash,
    grantSetHash: input.activeSet.grantSetHash,
    effectPolicyHash: input.activeSet.effectPolicyHash,
    isolationPolicyHash: input.activeSet.isolationPolicyHash,
  });

  if (recomputedHash !== activeSetHash) {
    throw new Error(
      `REFLECTION-01: active set hash mismatch — declared ${activeSetHash} but recomputed ${recomputedHash}`,
    );
  }

  const entries: CapabilityCatalogEntryV1[] = [];

  for (const identity of input.activeSet.components) {
    const manifest = input.manifests.get(identity.componentId);
    if (!manifest) {
      continue;
    }

    const observation = input.observations.get(identity.componentId);
    const rawState = observation?.lifecycleState ?? "declared";
    const reflectedState = toReflectedState(rawState);

    for (const provide of manifest.provides) {
      if (input.visibleCapabilities && !input.visibleCapabilities.has(provide.capability)) {
        continue;
      }

      entries.push({
        capability: provide.capability,
        version: provide.version,
        schemaHash: provide.schemaHash,
        componentId: manifest.componentId,
        lifecycleState: reflectedState,
        callable: isCallable(reflectedState),
      });
    }
  }

  entries.sort((a, b) => {
    const capCmp = a.capability < b.capability ? -1 : a.capability > b.capability ? 1 : 0;
    if (capCmp !== 0) return capCmp;
    const verCmp = a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
    if (verCmp !== 0) return verCmp;
    return a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0;
  });

  const catalogHash = computeCatalogHash(observedAt, activeSetHash, entries);

  return {
    schema: "werkstatt/capability-catalog@1",
    observedAt,
    resolvedComponentSetHash: activeSetHash,
    entries,
    catalogHash,
  };
}

export function assertNoForbiddenFields(catalog: CapabilityCatalogV1): void {
  const json = JSON.stringify(catalog);
  for (const forbidden of FORBIDDEN_FIELDS) {
    if (json.includes(forbidden)) {
      throw new Error(`REFLECTION-02: catalog contains forbidden field name: ${forbidden}`);
    }
  }
}

export interface LawKernelSummary {
  readonly activeGrants: number;
  readonly artifactStoreEntries: number;
  readonly killSwitchArmed: boolean;
}

export interface ComponentReflectionV1 {
  readonly componentId: ComponentId;
  readonly version: string;
  readonly artifactHash: string;
  readonly fiberState: ReflectedLifecycleState;
  readonly provides: readonly CapabilityProvideV1[];
  readonly requires: ReadonlyArray<
    CapabilityRequireV1 & {
      resolvedBy?: ComponentId;
      resolution: "resolved" | "waiting" | "missing";
    }
  >;
  readonly commands: readonly string[];
  readonly pipelines: readonly string[];
  readonly inFlightCount: number;
  readonly health?: {
    status: "healthy" | "degraded" | "unhealthy" | "unknown";
    lastCheckedAt?: string;
    latencyMs?: number;
  };
  readonly requestedGrants: readonly GrantRequestV1[];
  readonly effects: readonly EffectDeclarationV1[];
}

export interface RuntimeReflectionV1 {
  readonly reflectedAt: string;
  readonly components: readonly ComponentReflectionV1[];
  readonly dependencyEdges: ReadonlyArray<{
    from: ComponentId;
    to: ComponentId;
    capability: CapabilityId;
  }>;
  readonly lawKernel: LawKernelSummary;
  readonly summary: {
    total: number;
    active: number;
    waiting: number;
    draining: number;
    failed: number;
    quarantined: number;
    skippedDisposed: number;
  };
}

function buildDependencyEdges(
  manifests: ReadonlyMap<ComponentId, ComponentManifestV1>,
  componentIds: ReadonlySet<ComponentId>,
): RuntimeReflectionV1["dependencyEdges"] {
  const providerMap = new Map<CapabilityId, ComponentId[]>();
  for (const [compId, manifest] of manifests) {
    if (!componentIds.has(compId)) continue;
    for (const provide of manifest.provides) {
      const existing = providerMap.get(provide.capability);
      if (existing) {
        existing.push(compId);
      } else {
        providerMap.set(provide.capability, [compId]);
      }
    }
  }

  const edges: Array<{ from: ComponentId; to: ComponentId; capability: CapabilityId }> = [];
  for (const [compId, manifest] of manifests) {
    if (!componentIds.has(compId)) continue;
    for (const require of manifest.requires) {
      const providers = providerMap.get(require.capability);
      if (providers) {
        for (const providerId of providers) {
          if (providerId !== compId) {
            edges.push({ from: compId, to: providerId, capability: require.capability });
          }
        }
      }
    }
  }

  edges.sort((a, b) => {
    const fromCmp = a.from < b.from ? -1 : a.from > b.from ? 1 : 0;
    if (fromCmp !== 0) return fromCmp;
    const toCmp = a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
    if (toCmp !== 0) return toCmp;
    return a.capability < b.capability ? -1 : a.capability > b.capability ? 1 : 0;
  });

  return edges;
}

function resolveRequirement(
  require: CapabilityRequireV1,
  manifests: ReadonlyMap<ComponentId, ComponentManifestV1>,
  activeComponentIds: ReadonlySet<ComponentId>,
): CapabilityRequireV1 & {
  resolvedBy?: ComponentId;
  resolution: "resolved" | "waiting" | "missing";
} {
  for (const [compId, manifest] of manifests) {
    if (!activeComponentIds.has(compId)) continue;
    for (const provide of manifest.provides) {
      if (provide.capability === require.capability) {
        return { ...require, resolvedBy: compId, resolution: "resolved" as const };
      }
    }
  }
  return { ...require, resolution: require.optional ? "waiting" : "missing" };
}

export function reflectRuntime(
  input: ReflectionInput,
  lawKernel: LawKernelSummary,
): RuntimeReflectionV1 {
  const reflectedAt = input.observedAt ?? new Date().toISOString();

  const activeComponentIds = new Set<ComponentId>();
  for (const identity of input.activeSet.components) {
    const observation = input.observations.get(identity.componentId);
    if (observation && observation.lifecycleState === "disposed") {
      continue;
    }
    activeComponentIds.add(identity.componentId);
  }

  const components: ComponentReflectionV1[] = [];
  let skippedDisposed = 0;

  for (const identity of input.activeSet.components) {
    const manifest = input.manifests.get(identity.componentId);
    if (!manifest) {
      continue;
    }

    const observation = input.observations.get(identity.componentId);
    const rawState = observation?.lifecycleState ?? "declared";

    if (rawState === "disposed") {
      skippedDisposed++;
      continue;
    }

    const reflectedState = toReflectedState(rawState);

    const resolvedRequires = manifest.requires.map((req) =>
      resolveRequirement(req, input.manifests, activeComponentIds),
    );

    components.push({
      componentId: manifest.componentId,
      version: identity.version,
      artifactHash: manifest.artifactHash,
      fiberState: reflectedState,
      provides: manifest.provides,
      requires: resolvedRequires,
      commands: [],
      pipelines: [],
      inFlightCount: 0,
      requestedGrants: manifest.requestedGrants,
      effects: manifest.effects,
    });
  }

  const dependencyEdges = buildDependencyEdges(input.manifests, activeComponentIds);

  const summary = {
    total: components.length,
    active: components.filter((c) => c.fiberState === "active").length,
    waiting: components.filter((c) => c.fiberState === "waiting").length,
    draining: components.filter((c) => c.fiberState === "draining").length,
    failed: components.filter((c) => c.fiberState === "failed").length,
    quarantined: components.filter((c) => c.fiberState === "quarantined").length,
    skippedDisposed,
  };

  return {
    reflectedAt,
    components,
    dependencyEdges,
    lawKernel,
    summary,
  };
}
