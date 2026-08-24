import type {
  ComponentManifestV1,
  ComponentId,
  CapabilityId,
  CapabilityProvideV1,
  ResolvedComponentIdentityV1,
  ResolvedComponentSetV1,
} from "../component/contracts.ts";
import { parseComponentManifestV1 } from "../component/schemas.ts";
import {
  computeSetHash,
  computeDependencyGraphHash,
  computeGrantSetHash,
  computeEffectPolicyHash,
  computeIsolationPolicyHash,
} from "../component/identity.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type { ResolutionViolationV1, ResolutionProofV1 } from "./resolution-proof.ts";
import { createResolutionProof } from "./resolution-proof.ts";

export interface ComponentArtifactIndexV1 {
  readonly artifacts: ReadonlyMap<ComponentId, Sha256Digest>;
}

export interface AdmittedGrantSetV1 {
  readonly admitted: ReadonlyArray<{ scope: string; resource: string }>;
}

export interface ResolutionInputV1 {
  readonly profileId: string;
  readonly desired: readonly ComponentManifestV1[];
  readonly availableArtifacts: ComponentArtifactIndexV1;
  readonly admittedGrants: AdmittedGrantSetV1;
  readonly effectPolicyHash: string;
  readonly isolationPolicyHash: string;
}

export type ResolutionResultV1 =
  | { status: "resolved"; set: ResolvedComponentSetV1; proof: ResolutionProofV1 }
  | { status: "blocked"; violations: ResolutionViolationV1[] };

interface Edge {
  from: ComponentId;
  to: ComponentId;
}

function semverSatisfies(version: string, compatibility: string): boolean {
  const vParts = version.split(".").map(Number);
  if (vParts.length !== 3 || vParts.some((n) => Number.isNaN(n))) {
    return false;
  }
  const [vMajor, vMinor, vPatch] = vParts;

  const trimmed = compatibility.trim();
  if (trimmed.startsWith("^")) {
    const reqParts = trimmed.slice(1).split(".").map(Number);
    if (reqParts.length !== 3 || reqParts.some((n) => Number.isNaN(n))) {
      return false;
    }
    const [rMajor, rMinor, rPatch] = reqParts;
    if (rMajor !== vMajor) return false;
    if (vMinor < rMinor) return false;
    if (vMinor === rMinor && vPatch < rPatch) return false;
    return true;
  }
  if (trimmed.startsWith("~")) {
    const reqParts = trimmed.slice(1).split(".").map(Number);
    if (reqParts.length !== 3 || reqParts.some((n) => Number.isNaN(n))) {
      return false;
    }
    const [rMajor, rMinor] = reqParts;
    return rMajor === vMajor && rMinor === vMinor;
  }
  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    return version === trimmed;
  }
  return false;
}

function findProviders(
  capability: CapabilityId,
  manifests: readonly ComponentManifestV1[],
): Array<{ manifest: ComponentManifestV1; provide: CapabilityProvideV1 }> {
  const providers: Array<{ manifest: ComponentManifestV1; provide: CapabilityProvideV1 }> = [];
  for (const m of manifests) {
    for (const p of m.provides) {
      if (p.capability === capability) {
        providers.push({ manifest: m, provide: p });
      }
    }
  }
  return providers;
}

function detectCycle(
  edges: readonly Edge[],
  componentIds: readonly ComponentId[],
): ComponentId[] | null {
  const adj = new Map<ComponentId, ComponentId[]>();
  for (const id of componentIds) {
    adj.set(id, []);
  }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<ComponentId, number>();
  for (const id of componentIds) {
    color.set(id, WHITE);
  }

  let cyclePath: ComponentId[] | null = null;

  function dfs(u: ComponentId, path: ComponentId[]): boolean {
    color.set(u, GRAY);
    path.push(u);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GRAY) {
        const idx = path.indexOf(v);
        cyclePath = path.slice(idx).concat(v);
        return true;
      }
      if (color.get(v) === WHITE) {
        if (dfs(v, path)) return true;
      }
    }
    path.pop();
    color.set(u, BLACK);
    return false;
  }

  for (const id of componentIds) {
    if (color.get(id) === WHITE) {
      if (dfs(id, [])) return cyclePath;
    }
  }
  return null;
}

function topologicalSort(
  edges: readonly Edge[],
  componentIds: readonly ComponentId[],
): { order: ComponentId[] | null; maxDepth: number } {
  const inDegree = new Map<ComponentId, number>();
  for (const id of componentIds) {
    inDegree.set(id, 0);
  }
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const adj = new Map<ComponentId, ComponentId[]>();
  for (const id of componentIds) {
    adj.set(id, []);
  }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
  }

  const queue: ComponentId[] = componentIds.filter((id) => (inDegree.get(id) ?? 0) === 0).sort();

  const order: ComponentId[] = [];
  const depth = new Map<ComponentId, number>();
  for (const id of queue) {
    depth.set(id, 0);
  }

  while (queue.length > 0) {
    const u = queue.shift()!;
    order.push(u);
    const neighbors = (adj.get(u) ?? []).sort();
    for (const v of neighbors) {
      const newDeg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, newDeg);
      const d = Math.max(depth.get(v) ?? 0, (depth.get(u) ?? 0) + 1);
      depth.set(v, d);
      if (newDeg === 0) {
        queue.push(v);
        queue.sort();
      }
    }
  }

  if (order.length !== componentIds.length) {
    return { order: null, maxDepth: 0 };
  }

  const maxDepth = Math.max(...Array.from(depth.values()), 0);
  return { order, maxDepth };
}

export function resolve(input: ResolutionInputV1): ResolutionResultV1 {
  const violations: ResolutionViolationV1[] = [];

  // 1. Validate every manifest
  for (const manifest of input.desired) {
    const result = parseComponentManifestV1(manifest);
    if (result.status === "fail") {
      for (const v of result.violations) {
        violations.push({
          code: "RESOLUTION-01",
          componentId: manifest.componentId,
          capability: null,
          message: `manifest validation failed: ${v.rule} — ${v.message}`,
        });
      }
    }
  }
  if (violations.length > 0) {
    return { status: "blocked", violations };
  }

  // 2. Check artifact availability
  for (const manifest of input.desired) {
    const available = input.availableArtifacts.artifacts.get(manifest.componentId);
    if (!available) {
      violations.push({
        code: "RESOLUTION-02",
        componentId: manifest.componentId,
        capability: null,
        message: `artifact not available for ${manifest.componentId}`,
      });
    } else if (available !== manifest.artifactHash) {
      violations.push({
        code: "RESOLUTION-02",
        componentId: manifest.componentId,
        capability: null,
        message: `artifact hash mismatch for ${manifest.componentId}: expected ${manifest.artifactHash}, got ${available}`,
      });
    }
  }
  if (violations.length > 0) {
    return { status: "blocked", violations };
  }

  // 3. Check admitted grants
  const admittedSet = new Set(input.admittedGrants.admitted.map((g) => `${g.scope}:${g.resource}`));
  for (const manifest of input.desired) {
    for (const grant of manifest.requestedGrants) {
      const key = `${grant.scope}:${grant.resource}`;
      if (!admittedSet.has(key)) {
        violations.push({
          code: "RESOLUTION-03",
          componentId: manifest.componentId,
          capability: null,
          message: `grant not admitted: ${key} for ${manifest.componentId}`,
        });
      }
    }
  }
  if (violations.length > 0) {
    return { status: "blocked", violations };
  }

  // 4. Match required capabilities
  const edges: Edge[] = [];
  for (const manifest of input.desired) {
    for (const req of manifest.requires) {
      const providers = findProviders(req.capability, input.desired);
      if (providers.length === 0 && !req.optional) {
        violations.push({
          code: "RESOLUTION-04",
          componentId: manifest.componentId,
          capability: req.capability,
          message: `no provider for required capability ${req.capability} required by ${manifest.componentId}`,
        });
        continue;
      }
      if (providers.length === 0 && req.optional) {
        continue;
      }

      const compatible = providers.filter(
        (p) =>
          semverSatisfies(p.provide.version, req.compatibility) &&
          p.provide.schemaHash === req.schemaHash,
      );

      if (compatible.length === 0) {
        if (!req.optional) {
          violations.push({
            code: "RESOLUTION-05",
            componentId: manifest.componentId,
            capability: req.capability,
            message: `no compatible provider for ${req.capability} (compatibility ${req.compatibility}) required by ${manifest.componentId}`,
          });
        }
        continue;
      }

      if (compatible.length > 1) {
        violations.push({
          code: "RESOLUTION-06",
          componentId: manifest.componentId,
          capability: req.capability,
          message: `multiple compatible providers for ${req.capability}: ${compatible.map((c) => c.manifest.componentId).join(", ")}`,
        });
        continue;
      }

      const provider = compatible[0]!;
      if (provider.manifest.componentId !== manifest.componentId) {
        edges.push({ from: manifest.componentId, to: provider.manifest.componentId });
      }
    }
  }
  if (violations.length > 0) {
    return { status: "blocked", violations };
  }

  // 5. Detect cycles
  const componentIds = input.desired.map((m) => m.componentId);
  const cycle = detectCycle(edges, componentIds);
  if (cycle) {
    violations.push({
      code: "RESOLUTION-07",
      componentId: cycle[0] ?? null,
      capability: null,
      message: `dependency cycle detected: ${cycle.join(" -> ")}`,
      cyclePath: cycle,
    });
    return { status: "blocked", violations };
  }

  // 6. Topological sort with canonical tie-breaking
  const { order, maxDepth } = topologicalSort(edges, componentIds);
  if (!order) {
    violations.push({
      code: "RESOLUTION-07",
      componentId: null,
      capability: null,
      message: "topological sort failed (cycle or missing component)",
    });
    return { status: "blocked", violations };
  }

  // 7. Build resolved set
  const manifestMap = new Map(
    componentIds.map((id) => {
      const m = input.desired.find((d) => d.componentId === id)!;
      return [id, m] as const;
    }),
  );

  const resolvedComponents: ResolvedComponentIdentityV1[] = order.map((id) => {
    const m = manifestMap.get(id)!;
    return {
      componentId: m.componentId,
      version: m.version,
      artifactHash: m.artifactHash,
    };
  });

  const dependencyGraphHash = computeDependencyGraphHash(
    edges.map((e) => ({ from: e.from, to: e.to })),
  );
  const grantSetHash = computeGrantSetHash(
    input.desired.flatMap((m) =>
      m.requestedGrants.map((g) => ({
        componentId: m.componentId,
        scope: g.scope,
        resource: g.resource,
        attenuated: g.attenuated,
      })),
    ),
  );
  const effectPolicyHash = computeEffectPolicyHash(
    input.desired.flatMap((m) =>
      m.effects.map((e) => ({
        componentId: m.componentId,
        effectClass: e.effectClass,
      })),
    ),
  );
  const isolationPolicyHash = computeIsolationPolicyHash(
    input.desired.map((m) => ({
      componentId: m.componentId,
      tier: m.isolation.tier,
      adapterId: m.isolation.adapterId,
    })),
  );

  const setWithoutHash: Omit<ResolvedComponentSetV1, "setHash"> = {
    schema: "werkstatt/resolved-component-set@1",
    profileId: input.profileId,
    components: resolvedComponents,
    dependencyGraphHash,
    grantSetHash,
    effectPolicyHash: input.effectPolicyHash || effectPolicyHash,
    isolationPolicyHash: input.isolationPolicyHash || isolationPolicyHash,
  };

  const setHash = computeSetHash(setWithoutHash);
  const set: ResolvedComponentSetV1 = { ...setWithoutHash, setHash };
  const proof = createResolutionProof(input.profileId, set, edges.length, maxDepth);

  return { status: "resolved", set, proof };
}
