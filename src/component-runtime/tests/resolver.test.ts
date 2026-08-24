import { describe, it, expect } from "vitest";
import { resolve, type ResolutionInputV1 } from "../resolver.ts";
import type { ComponentManifestV1, ComponentId } from "../../component/contracts.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

const VALID_SHA = ("sha256:" + "a".repeat(64)) as Sha256Digest;
const VALID_SHA_2 = ("sha256:" + "b".repeat(64)) as Sha256Digest;

function cid(id: string): ComponentId {
  return id as ComponentId;
}

function makeManifest(overrides: Partial<ComponentManifestV1> = {}): ComponentManifestV1 {
  const componentId = overrides.componentId ?? "werkstatt/engine";
  return {
    schema: "werkstatt/component-manifest@1",
    componentId,
    version: "1.0.0",
    artifactHash: VALID_SHA as string,
    provides: [
      { capability: "werkstatt/kernel", version: "1.0.0", schemaHash: VALID_SHA as string },
    ],
    requires: [],
    requestedGrants: [],
    effects: [
      {
        effectClass: "revertible",
        description: "test",
        recoveryCommand: null,
        commitMetadata: null,
      },
    ],
    isolation: { tier: "trusted-in-process", adapterId: null },
    resources: [{ kind: "cpu", limit: "100ms", owner: componentId, lifecycle: "process" }],
    ...overrides,
  };
}

function makeInput(overrides: Partial<ResolutionInputV1> = {}): ResolutionInputV1 {
  return {
    profileId: "astro-typescript-turborepo",
    desired: [makeManifest()],
    availableArtifacts: { artifacts: new Map([[cid("werkstatt/engine"), VALID_SHA]]) },
    admittedGrants: { admitted: [] },
    effectPolicyHash: VALID_SHA as string,
    isolationPolicyHash: VALID_SHA as string,
    ...overrides,
  };
}

describe("resolve", () => {
  it("resolves a single component with no dependencies", () => {
    const result = resolve(makeInput());
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.set.components).toHaveLength(1);
      expect(result.set.components[0]!.componentId).toBe("werkstatt/engine");
      expect(result.proof.componentCount).toBe(1);
      expect(result.proof.edgeCount).toBe(0);
    }
  });

  it("resolves two components with a dependency", () => {
    const engine = makeManifest({
      componentId: "werkstatt/engine",
      requires: [
        {
          capability: "werkstatt/fingerprint",
          compatibility: "^1.0.0",
          schemaHash: VALID_SHA as string,
          optional: false,
        },
      ],
    });
    const fp = makeManifest({
      componentId: "werkstatt/fingerprint",
      version: "1.0.0",
      provides: [
        { capability: "werkstatt/fingerprint", version: "1.0.0", schemaHash: VALID_SHA as string },
      ],
      requires: [],
    });

    const input = makeInput({
      desired: [engine, fp],
      availableArtifacts: {
        artifacts: new Map([
          [cid("werkstatt/engine"), VALID_SHA],
          [cid("werkstatt/fingerprint"), VALID_SHA],
        ]),
      },
    });

    const result = resolve(input);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.set.components).toHaveLength(2);
      expect(result.proof.edgeCount).toBe(1);
      expect(result.proof.maxDepth).toBe(1);
    }
  });

  it("is deterministic under input permutation", () => {
    const a = makeManifest({
      componentId: "werkstatt/alpha",
      provides: [
        { capability: "werkstatt/alpha-cap", version: "1.0.0", schemaHash: VALID_SHA as string },
      ],
      requires: [],
    });
    const b = makeManifest({
      componentId: "werkstatt/beta",
      provides: [
        { capability: "werkstatt/beta-cap", version: "1.0.0", schemaHash: VALID_SHA as string },
      ],
      requires: [
        {
          capability: "werkstatt/alpha-cap",
          compatibility: "^1.0.0",
          schemaHash: VALID_SHA as string,
          optional: false,
        },
      ],
    });

    const artifacts = new Map([
      [cid("werkstatt/alpha"), VALID_SHA],
      [cid("werkstatt/beta"), VALID_SHA],
    ]);

    const input1 = makeInput({ desired: [a, b], availableArtifacts: { artifacts } });
    const input2 = makeInput({ desired: [b, a], availableArtifacts: { artifacts } });

    const r1 = resolve(input1);
    const r2 = resolve(input2);

    expect(r1.status).toBe("resolved");
    expect(r2.status).toBe("resolved");
    if (r1.status === "resolved" && r2.status === "resolved") {
      expect(r1.set.setHash).toBe(r2.set.setHash);
    }
  });

  it("blocks on missing artifact", () => {
    const result = resolve(
      makeInput({
        availableArtifacts: { artifacts: new Map() },
      }),
    );
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.violations.some((v) => v.code === "RESOLUTION-02")).toBe(true);
    }
  });

  it("blocks on artifact hash mismatch", () => {
    const result = resolve(
      makeInput({
        availableArtifacts: { artifacts: new Map([["werkstatt/engine", VALID_SHA_2]]) },
      }),
    );
    expect(result.status).toBe("blocked");
  });

  it("blocks on missing required capability", () => {
    const manifest = makeManifest({
      requires: [
        {
          capability: "werkstatt/missing",
          compatibility: "^1.0.0",
          schemaHash: VALID_SHA as string,
          optional: false,
        },
      ],
    });
    const result = resolve(makeInput({ desired: [manifest] }));
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.violations.some((v) => v.code === "RESOLUTION-04")).toBe(true);
    }
  });

  it("blocks on incompatible version", () => {
    const engine = makeManifest({
      componentId: "werkstatt/engine",
      requires: [
        {
          capability: "werkstatt/fingerprint",
          compatibility: "^2.0.0",
          schemaHash: VALID_SHA as string,
          optional: false,
        },
      ],
    });
    const fp = makeManifest({
      componentId: "werkstatt/fingerprint",
      version: "1.5.0",
      provides: [
        { capability: "werkstatt/fingerprint", version: "1.5.0", schemaHash: VALID_SHA as string },
      ],
      requires: [],
    });

    const result = resolve(
      makeInput({
        desired: [engine, fp],
        availableArtifacts: {
          artifacts: new Map([
            [cid("werkstatt/engine"), VALID_SHA],
            [cid("werkstatt/fingerprint"), VALID_SHA],
          ]),
        },
      }),
    );
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.violations.some((v) => v.code === "RESOLUTION-05")).toBe(true);
    }
  });

  it("blocks on multiple compatible providers", () => {
    const a = makeManifest({
      componentId: "werkstatt/provider-a",
      provides: [
        { capability: "werkstatt/shared", version: "1.0.0", schemaHash: VALID_SHA as string },
      ],
      requires: [],
    });
    const b = makeManifest({
      componentId: "werkstatt/provider-b",
      provides: [
        { capability: "werkstatt/shared", version: "1.0.0", schemaHash: VALID_SHA as string },
      ],
      requires: [],
    });
    const consumer = makeManifest({
      componentId: "werkstatt/consumer",
      provides: [
        { capability: "werkstatt/consumer-cap", version: "1.0.0", schemaHash: VALID_SHA as string },
      ],
      requires: [
        {
          capability: "werkstatt/shared",
          compatibility: "^1.0.0",
          schemaHash: VALID_SHA as string,
          optional: false,
        },
      ],
    });

    const result = resolve(
      makeInput({
        desired: [a, b, consumer],
        availableArtifacts: {
          artifacts: new Map([
            [cid("werkstatt/provider-a"), VALID_SHA],
            [cid("werkstatt/provider-b"), VALID_SHA],
            [cid("werkstatt/consumer"), VALID_SHA],
          ]),
        },
      }),
    );
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.violations.some((v) => v.code === "RESOLUTION-06")).toBe(true);
    }
  });

  it("blocks on dependency cycle", () => {
    const a = makeManifest({
      componentId: "werkstatt/cycle-a",
      provides: [
        { capability: "werkstatt/cap-a", version: "1.0.0", schemaHash: VALID_SHA as string },
      ],
      requires: [
        {
          capability: "werkstatt/cap-b",
          compatibility: "^1.0.0",
          schemaHash: VALID_SHA as string,
          optional: false,
        },
      ],
    });
    const b = makeManifest({
      componentId: "werkstatt/cycle-b",
      provides: [
        { capability: "werkstatt/cap-b", version: "1.0.0", schemaHash: VALID_SHA as string },
      ],
      requires: [
        {
          capability: "werkstatt/cap-a",
          compatibility: "^1.0.0",
          schemaHash: VALID_SHA as string,
          optional: false,
        },
      ],
    });

    const result = resolve(
      makeInput({
        desired: [a, b],
        availableArtifacts: {
          artifacts: new Map([
            [cid("werkstatt/cycle-a"), VALID_SHA],
            [cid("werkstatt/cycle-b"), VALID_SHA],
          ]),
        },
      }),
    );
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.violations.some((v) => v.code === "RESOLUTION-07")).toBe(true);
    }
  });

  it("blocks on unadmitted grant", () => {
    const manifest = makeManifest({
      requestedGrants: [{ scope: "read", resource: "dossier", attenuated: true }],
    });
    const result = resolve(
      makeInput({
        desired: [manifest],
        admittedGrants: { admitted: [] },
      }),
    );
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.violations.some((v) => v.code === "RESOLUTION-03")).toBe(true);
    }
  });

  it("optional missing capability does not block", () => {
    const manifest = makeManifest({
      requires: [
        {
          capability: "werkstatt/optional",
          compatibility: "^1.0.0",
          schemaHash: VALID_SHA as string,
          optional: true,
        },
      ],
    });
    const result = resolve(makeInput({ desired: [manifest] }));
    expect(result.status).toBe("resolved");
  });

  it("semverSatisfies: caret range", () => {
    const engine = makeManifest({
      componentId: "werkstatt/engine",
      requires: [
        {
          capability: "werkstatt/fingerprint",
          compatibility: "^1.2.0",
          schemaHash: VALID_SHA as string,
          optional: false,
        },
      ],
    });
    const fp = makeManifest({
      componentId: "werkstatt/fingerprint",
      version: "1.2.5",
      provides: [
        { capability: "werkstatt/fingerprint", version: "1.2.5", schemaHash: VALID_SHA as string },
      ],
      requires: [],
    });

    const result = resolve(
      makeInput({
        desired: [engine, fp],
        availableArtifacts: {
          artifacts: new Map([
            [cid("werkstatt/engine"), VALID_SHA],
            [cid("werkstatt/fingerprint"), VALID_SHA],
          ]),
        },
      }),
    );
    expect(result.status).toBe("resolved");
  });
});
