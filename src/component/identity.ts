import {
  snapshotCanonicalJsonObjectV1,
  canonicalJsonHashV1,
} from "../fingerprint/canonical-json.ts";
import { type Sha256Digest } from "../fingerprint/primitives.ts";
import type {
  ComponentManifestV1,
  ResolvedComponentIdentityV1,
  ResolvedComponentSetV1,
} from "./contracts.ts";

function sortByIdentity<T>(items: T[], keyFn: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function manifestIdentityPayload(manifest: ComponentManifestV1): unknown {
  return {
    schema: manifest.schema,
    componentId: manifest.componentId,
    version: manifest.version,
    artifactHash: manifest.artifactHash,
    provides: sortByIdentity(manifest.provides, (p) => `${p.capability}@${p.version}`),
    requires: sortByIdentity(manifest.requires, (r) => `${r.capability}@${r.compatibility}`),
    requestedGrants: sortByIdentity(manifest.requestedGrants, (g) => `${g.scope}:${g.resource}`),
    effects: sortByIdentity(manifest.effects, (e) => e.effectClass),
    isolation: {
      tier: manifest.isolation.tier,
      adapterId: manifest.isolation.adapterId,
    },
    resources: sortByIdentity(manifest.resources, (r) => `${r.kind}:${r.owner}:${r.lifecycle}`),
  };
}

export function computeManifestHash(manifest: ComponentManifestV1): Sha256Digest {
  const result = snapshotCanonicalJsonObjectV1(manifestIdentityPayload(manifest));
  if (!result.ok) {
    throw new Error(`CERT-CANONICAL-${result.code}: failed to snapshot manifest identity payload`);
  }
  return canonicalJsonHashV1(result.value);
}

function resolvedComponentIdentityPayload(c: ResolvedComponentIdentityV1): unknown {
  return {
    componentId: c.componentId,
    version: c.version,
    artifactHash: c.artifactHash,
  };
}

function resolvedSetIdentityPayload(set: Omit<ResolvedComponentSetV1, "setHash">): unknown {
  const sortedComponents = sortByIdentity(set.components, (c) => `${c.componentId}@${c.version}`);

  return {
    schema: set.schema,
    profileId: set.profileId,
    components: sortedComponents.map(resolvedComponentIdentityPayload),
    dependencyGraphHash: set.dependencyGraphHash,
    grantSetHash: set.grantSetHash,
    effectPolicyHash: set.effectPolicyHash,
    isolationPolicyHash: set.isolationPolicyHash,
  };
}

export function computeSetHash(set: Omit<ResolvedComponentSetV1, "setHash">): Sha256Digest {
  const result = snapshotCanonicalJsonObjectV1(resolvedSetIdentityPayload(set));
  if (!result.ok) {
    throw new Error(
      `CERT-CANONICAL-${result.code}: failed to snapshot resolved set identity payload`,
    );
  }
  return canonicalJsonHashV1(result.value);
}

export function verifySetHash(set: ResolvedComponentSetV1): boolean {
  const { setHash: declared, ...rest } = set;
  const recomputed = computeSetHash(rest);
  return recomputed === declared;
}

export interface SetHashMismatchViolation {
  rule: string;
  path: string;
  message: string;
  expected: string;
  actual: string;
}

export function verifySetHashStrict(set: ResolvedComponentSetV1): {
  valid: boolean;
  violation: SetHashMismatchViolation | null;
} {
  const { setHash: declared, ...rest } = set;
  const recomputed = computeSetHash(rest);
  if (recomputed === declared) {
    return { valid: true, violation: null };
  }
  return {
    valid: false,
    violation: {
      rule: "COMPONENT-CONTRACT-07",
      path: "setHash",
      message: "recomputed setHash does not match declared setHash",
      expected: recomputed,
      actual: declared,
    },
  };
}

export function computeDependencyGraphHash(
  edges: Array<{ from: string; to: string }>,
): Sha256Digest {
  const sorted = sortByIdentity(edges, (e) => `${e.from}->${e.to}`);
  const payload = { edges: sorted.map((e) => ({ from: e.from, to: e.to })) };
  const result = snapshotCanonicalJsonObjectV1(payload);
  if (!result.ok) {
    throw new Error(`CERT-CANONICAL-${result.code}: failed to snapshot dependency graph`);
  }
  return canonicalJsonHashV1(result.value);
}

export function computeGrantSetHash(
  grants: Array<{ componentId: string; scope: string; resource: string; attenuated: boolean }>,
): Sha256Digest {
  const sorted = sortByIdentity(grants, (g) => `${g.componentId}:${g.scope}:${g.resource}`);
  const payload = { grants: sorted };
  const result = snapshotCanonicalJsonObjectV1(payload);
  if (!result.ok) {
    throw new Error(`CERT-CANONICAL-${result.code}: failed to snapshot grant set`);
  }
  return canonicalJsonHashV1(result.value);
}

export function computeEffectPolicyHash(
  effects: Array<{ componentId: string; effectClass: string }>,
): Sha256Digest {
  const sorted = sortByIdentity(effects, (e) => `${e.componentId}:${e.effectClass}`);
  const payload = { effects: sorted };
  const result = snapshotCanonicalJsonObjectV1(payload);
  if (!result.ok) {
    throw new Error(`CERT-CANONICAL-${result.code}: failed to snapshot effect policy`);
  }
  return canonicalJsonHashV1(result.value);
}

export function computeIsolationPolicyHash(
  isolations: Array<{ componentId: string; tier: string; adapterId: string | null }>,
): Sha256Digest {
  const sorted = sortByIdentity(isolations, (i) => `${i.componentId}:${i.tier}`);
  const payload = { isolations: sorted };
  const result = snapshotCanonicalJsonObjectV1(payload);
  if (!result.ok) {
    throw new Error(`CERT-CANONICAL-${result.code}: failed to snapshot isolation policy`);
  }
  return canonicalJsonHashV1(result.value);
}
