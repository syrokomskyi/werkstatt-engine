import type {
  CapabilityId,
  ComponentId,
  ComponentManifestV1,
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
