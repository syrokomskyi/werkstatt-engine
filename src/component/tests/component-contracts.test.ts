import { describe, it, expect } from "vitest";
import { parseComponentManifestV1, parseResolvedComponentSetV1 } from "../schemas.ts";
import {
  computeManifestHash,
  computeSetHash,
  verifySetHash,
  verifySetHashStrict,
  computeDependencyGraphHash,
  computeGrantSetHash,
  computeEffectPolicyHash,
  computeIsolationPolicyHash,
} from "../identity.ts";
import type {
  ComponentManifestV1,
  ResolvedComponentSetV1,
  ResolvedComponentIdentityV1,
} from "../contracts.ts";

const VALID_SHA = "sha256:" + "a".repeat(64);
const VALID_SHA_2 = "sha256:" + "b".repeat(64);

function makeValidManifest(overrides: Partial<ComponentManifestV1> = {}): ComponentManifestV1 {
  return {
    schema: "werkstatt/component-manifest@1",
    componentId: "werkstatt/engine",
    version: "1.0.0",
    artifactHash: VALID_SHA,
    provides: [{ capability: "werkstatt/kernel", version: "1.0.0", schemaHash: VALID_SHA }],
    requires: [
      {
        capability: "werkstatt/fingerprint",
        compatibility: "^1.0.0",
        schemaHash: VALID_SHA,
        optional: false,
      },
    ],
    requestedGrants: [{ scope: "read", resource: "dossier", attenuated: true }],
    effects: [
      {
        effectClass: "revertible",
        description: "read-only",
        recoveryCommand: null,
        commitMetadata: null,
      },
    ],
    isolation: { tier: "trusted-in-process", adapterId: null },
    resources: [{ kind: "cpu", limit: "100ms", owner: "werkstatt/engine", lifecycle: "process" }],
    ...overrides,
  };
}

function makeResolvedIdentity(
  overrides: Partial<ResolvedComponentIdentityV1> = {},
): ResolvedComponentIdentityV1 {
  return {
    componentId: "werkstatt/engine",
    version: "1.0.0",
    artifactHash: VALID_SHA,
    ...overrides,
  };
}

function makeValidSet(
  overrides: Partial<Omit<ResolvedComponentSetV1, "setHash">> = {},
): Omit<ResolvedComponentSetV1, "setHash"> {
  return {
    schema: "werkstatt/resolved-component-set@1",
    profileId: "astro-typescript-turborepo",
    components: [makeResolvedIdentity()],
    dependencyGraphHash: VALID_SHA,
    grantSetHash: VALID_SHA,
    effectPolicyHash: VALID_SHA,
    isolationPolicyHash: VALID_SHA,
    ...overrides,
  };
}

describe("parseComponentManifestV1", () => {
  it("accepts a valid manifest", () => {
    const manifest = makeValidManifest();
    const result = parseComponentManifestV1(manifest);
    expect(result.status).toBe("pass");
    expect(result.data).not.toBeNull();
    expect(result.violations).toHaveLength(0);
  });

  it("rejects unknown schema string", () => {
    const result = parseComponentManifestV1({
      ...makeValidManifest(),
      schema: "werkstatt/component-manifest@2",
    });
    expect(result.status).toBe("fail");
    expect(result.violations.some((v) => v.rule === "COMPONENT-CONTRACT-01")).toBe(true);
  });

  it("rejects unknown field", () => {
    const result = parseComponentManifestV1({ ...makeValidManifest(), extraField: "bad" });
    expect(result.status).toBe("fail");
    expect(result.violations.some((v) => v.rule === "COMPONENT-CONTRACT-01")).toBe(true);
  });

  it("rejects invalid componentId (uppercase)", () => {
    const result = parseComponentManifestV1({
      ...makeValidManifest(),
      componentId: "Werkstatt/Engine",
    });
    expect(result.status).toBe("fail");
  });

  it("rejects invalid componentId (no namespace)", () => {
    const result = parseComponentManifestV1({ ...makeValidManifest(), componentId: "engine" });
    expect(result.status).toBe("fail");
  });

  it("rejects invalid version (not semver)", () => {
    const result = parseComponentManifestV1({ ...makeValidManifest(), version: "latest" });
    expect(result.status).toBe("fail");
  });

  it("rejects invalid artifactHash (not sha256)", () => {
    const result = parseComponentManifestV1({ ...makeValidManifest(), artifactHash: "abc123" });
    expect(result.status).toBe("fail");
  });

  it("rejects empty provides array", () => {
    const result = parseComponentManifestV1({ ...makeValidManifest(), provides: [] });
    expect(result.status).toBe("fail");
  });

  it("rejects duplicate provides", () => {
    const manifest = makeValidManifest({
      provides: [
        { capability: "werkstatt/kernel", version: "1.0.0", schemaHash: VALID_SHA },
        { capability: "werkstatt/kernel", version: "1.0.0", schemaHash: VALID_SHA },
      ],
    });
    const result = parseComponentManifestV1(manifest);
    expect(result.status).toBe("fail");
    expect(result.violations.some((v) => v.rule === "COMPONENT-CONTRACT-03")).toBe(true);
  });

  it("rejects Law Kernel reserved grant scope: certify", () => {
    const manifest = makeValidManifest({
      requestedGrants: [{ scope: "certify", resource: "release", attenuated: false }],
    });
    const result = parseComponentManifestV1(manifest);
    expect(result.status).toBe("fail");
    expect(result.violations.some((v) => v.rule === "COMPONENT-CONTRACT-06")).toBe(true);
  });

  it("rejects Law Kernel reserved grant scope: administer", () => {
    const manifest = makeValidManifest({
      requestedGrants: [{ scope: "administer", resource: "system", attenuated: false }],
    });
    const result = parseComponentManifestV1(manifest);
    expect(result.status).toBe("fail");
    expect(result.violations.some((v) => v.rule === "COMPONENT-CONTRACT-06")).toBe(true);
  });

  it("rejects resource owner mismatch", () => {
    const manifest = makeValidManifest({
      resources: [{ kind: "cpu", limit: "100ms", owner: "werkstatt/other", lifecycle: "process" }],
    });
    const result = parseComponentManifestV1(manifest);
    expect(result.status).toBe("fail");
    expect(result.violations.some((v) => v.rule === "COMPONENT-CONTRACT-05")).toBe(true);
  });

  it("rejects unknown effect class", () => {
    const manifest = makeValidManifest({
      effects: [
        {
          effectClass: "magic" as never,
          description: "x",
          recoveryCommand: null,
          commitMetadata: null,
        },
      ],
    });
    const result = parseComponentManifestV1(manifest);
    expect(result.status).toBe("fail");
  });

  it("rejects unknown isolation tier", () => {
    const manifest = makeValidManifest({
      isolation: { tier: "partially-trusted" as never, adapterId: null },
    });
    const result = parseComponentManifestV1(manifest);
    expect(result.status).toBe("fail");
  });

  it("rejects null input", () => {
    const result = parseComponentManifestV1(null);
    expect(result.status).toBe("fail");
  });

  it("rejects array input", () => {
    const result = parseComponentManifestV1([]);
    expect(result.status).toBe("fail");
  });
});

describe("parseResolvedComponentSetV1", () => {
  it("accepts a valid set", () => {
    const set = makeValidSet();
    const result = parseResolvedComponentSetV1({ ...set, setHash: VALID_SHA });
    expect(result.status).toBe("pass");
    expect(result.data).not.toBeNull();
  });

  it("rejects unknown schema", () => {
    const set = makeValidSet({ schema: "werkstatt/resolved-component-set@2" as never });
    const result = parseResolvedComponentSetV1({ ...set, setHash: VALID_SHA });
    expect(result.status).toBe("fail");
  });

  it("rejects unknown field", () => {
    const set = makeValidSet();
    const result = parseResolvedComponentSetV1({ ...set, setHash: VALID_SHA, extra: "bad" });
    expect(result.status).toBe("fail");
  });

  it("rejects empty components", () => {
    const set = makeValidSet({ components: [] });
    const result = parseResolvedComponentSetV1({ ...set, setHash: VALID_SHA });
    expect(result.status).toBe("fail");
  });

  it("rejects duplicate components", () => {
    const id = makeResolvedIdentity();
    const set = makeValidSet({ components: [id, { ...id }] });
    const result = parseResolvedComponentSetV1({ ...set, setHash: VALID_SHA });
    expect(result.status).toBe("fail");
    expect(result.violations.some((v) => v.rule === "COMPONENT-CONTRACT-04")).toBe(true);
  });
});

describe("computeSetHash — input-order invariance", () => {
  it("produces identical setHash regardless of component input order", () => {
    const c1 = makeResolvedIdentity({
      componentId: "werkstatt/alpha",
      version: "1.0.0",
      artifactHash: VALID_SHA,
    });
    const c2 = makeResolvedIdentity({
      componentId: "werkstatt/beta",
      version: "2.0.0",
      artifactHash: VALID_SHA_2,
    });

    const setA = makeValidSet({ components: [c1, c2] });
    const setB = makeValidSet({ components: [c2, c1] });

    expect(computeSetHash(setA)).toBe(computeSetHash(setB));
  });
});

describe("computeSetHash — sensitivity", () => {
  it("changes when component version changes", () => {
    const c1 = makeResolvedIdentity({ version: "1.0.0" });
    const c2 = makeResolvedIdentity({ version: "1.0.1" });
    const setA = makeValidSet({ components: [c1] });
    const setB = makeValidSet({ components: [c2] });
    expect(computeSetHash(setA)).not.toBe(computeSetHash(setB));
  });

  it("changes when artifactHash changes", () => {
    const c1 = makeResolvedIdentity({ artifactHash: VALID_SHA });
    const c2 = makeResolvedIdentity({ artifactHash: VALID_SHA_2 });
    const setA = makeValidSet({ components: [c1] });
    const setB = makeValidSet({ components: [c2] });
    expect(computeSetHash(setA)).not.toBe(computeSetHash(setB));
  });

  it("changes when profileId changes", () => {
    const setA = makeValidSet({ profileId: "astro-typescript-turborepo" });
    const setB = makeValidSet({ profileId: "phaser-turborepo" });
    expect(computeSetHash(setA)).not.toBe(computeSetHash(setB));
  });

  it("changes when dependencyGraphHash changes", () => {
    const setA = makeValidSet({ dependencyGraphHash: VALID_SHA });
    const setB = makeValidSet({ dependencyGraphHash: VALID_SHA_2 });
    expect(computeSetHash(setA)).not.toBe(computeSetHash(setB));
  });

  it("changes when grantSetHash changes", () => {
    const setA = makeValidSet({ grantSetHash: VALID_SHA });
    const setB = makeValidSet({ grantSetHash: VALID_SHA_2 });
    expect(computeSetHash(setA)).not.toBe(computeSetHash(setB));
  });

  it("changes when effectPolicyHash changes", () => {
    const setA = makeValidSet({ effectPolicyHash: VALID_SHA });
    const setB = makeValidSet({ effectPolicyHash: VALID_SHA_2 });
    expect(computeSetHash(setA)).not.toBe(computeSetHash(setB));
  });

  it("changes when isolationPolicyHash changes", () => {
    const setA = makeValidSet({ isolationPolicyHash: VALID_SHA });
    const setB = makeValidSet({ isolationPolicyHash: VALID_SHA_2 });
    expect(computeSetHash(setA)).not.toBe(computeSetHash(setB));
  });

  it("changes when a component is added", () => {
    const c1 = makeResolvedIdentity();
    const c2 = makeResolvedIdentity({
      componentId: "werkstatt/second",
      version: "1.0.0",
      artifactHash: VALID_SHA_2,
    });
    const setA = makeValidSet({ components: [c1] });
    const setB = makeValidSet({ components: [c1, c2] });
    expect(computeSetHash(setA)).not.toBe(computeSetHash(setB));
  });
});

describe("verifySetHash", () => {
  it("returns true when setHash matches recomputed hash", () => {
    const setWithoutHash = makeValidSet();
    const setHash = computeSetHash(setWithoutHash);
    const set: ResolvedComponentSetV1 = { ...setWithoutHash, setHash };
    expect(verifySetHash(set)).toBe(true);
  });

  it("returns false when setHash does not match", () => {
    const setWithoutHash = makeValidSet();
    const set: ResolvedComponentSetV1 = { ...setWithoutHash, setHash: VALID_SHA };
    expect(verifySetHash(set)).toBe(false);
  });

  it("verifySetHashStrict returns violation on mismatch", () => {
    const setWithoutHash = makeValidSet();
    const set: ResolvedComponentSetV1 = { ...setWithoutHash, setHash: VALID_SHA };
    const result = verifySetHashStrict(set);
    expect(result.valid).toBe(false);
    expect(result.violation).not.toBeNull();
    expect(result.violation!.rule).toBe("COMPONENT-CONTRACT-07");
  });

  it("verifySetHashStrict returns null violation on match", () => {
    const setWithoutHash = makeValidSet();
    const setHash = computeSetHash(setWithoutHash);
    const set: ResolvedComponentSetV1 = { ...setWithoutHash, setHash };
    const result = verifySetHashStrict(set);
    expect(result.valid).toBe(true);
    expect(result.violation).toBeNull();
  });
});

describe("computeManifestHash", () => {
  it("produces a sha256 digest", () => {
    const hash = computeManifestHash(makeValidManifest());
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic for identical manifests", () => {
    const m1 = makeValidManifest();
    const m2 = makeValidManifest();
    expect(computeManifestHash(m1)).toBe(computeManifestHash(m2));
  });

  it("changes when version changes", () => {
    expect(computeManifestHash(makeValidManifest({ version: "1.0.0" }))).not.toBe(
      computeManifestHash(makeValidManifest({ version: "2.0.0" })),
    );
  });

  it("is invariant to provides input order", () => {
    const p1 = { capability: "werkstatt/alpha" as const, version: "1.0.0", schemaHash: VALID_SHA };
    const p2 = { capability: "werkstatt/beta" as const, version: "1.0.0", schemaHash: VALID_SHA };
    const m1 = makeValidManifest({ provides: [p1, p2] });
    const m2 = makeValidManifest({ provides: [p2, p1] });
    expect(computeManifestHash(m1)).toBe(computeManifestHash(m2));
  });
});

describe("sub-hash functions", () => {
  it("computeDependencyGraphHash is order-invariant", () => {
    const edgesA = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    const edgesB = [
      { from: "b", to: "c" },
      { from: "a", to: "b" },
    ];
    expect(computeDependencyGraphHash(edgesA)).toBe(computeDependencyGraphHash(edgesB));
  });

  it("computeGrantSetHash is order-invariant", () => {
    const g1 = { componentId: "a/b", scope: "read", resource: "x", attenuated: true };
    const g2 = { componentId: "a/b", scope: "append", resource: "y", attenuated: false };
    expect(computeGrantSetHash([g1, g2])).toBe(computeGrantSetHash([g2, g1]));
  });

  it("computeEffectPolicyHash is order-invariant", () => {
    const e1 = { componentId: "a/b", effectClass: "revertible" };
    const e2 = { componentId: "a/b", effectClass: "transactional" };
    expect(computeEffectPolicyHash([e1, e2])).toBe(computeEffectPolicyHash([e2, e1]));
  });

  it("computeIsolationPolicyHash is order-invariant", () => {
    const i1 = { componentId: "a/b", tier: "sandboxed", adapterId: "wasm" };
    const i2 = { componentId: "c/d", tier: "trusted-in-process", adapterId: null };
    expect(computeIsolationPolicyHash([i1, i2])).toBe(computeIsolationPolicyHash([i2, i1]));
  });
});
