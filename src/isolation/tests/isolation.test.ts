import { describe, it, expect } from "vitest";
import {
  validateIsolationAdapter,
  validateBridgeRequest,
  attenuatedGrantSetV1Schema,
  isolationConformanceResultV1Schema,
} from "../schemas.ts";
import type {
  IsolationAdapterV1,
  IsolationPropertyEvidenceV1,
  AttenuatedGrantSetV1,
  CapabilityBridgeRequestV1,
  IsolationConformanceResultV1,
} from "../contracts.ts";
import {
  runIsolationConformance,
  createConformanceResult,
  type IsolationConformanceFixtureV1,
} from "../conformance.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

const VALID_SHA = ("sha256:" + "a".repeat(64)) as Sha256Digest;
const VALID_SHA_2 = ("sha256:" + "b".repeat(64)) as Sha256Digest;

function makeFullProperties(): IsolationPropertyEvidenceV1 {
  return {
    schema: "werkstatt/isolation-property-evidence@1",
    properties: [
      {
        kind: "containment",
        proven: true,
        evidenceHash: VALID_SHA,
        description: "containment proven",
      },
      {
        kind: "clean-room-startup",
        proven: true,
        evidenceHash: VALID_SHA,
        description: "clean-room proven",
      },
      {
        kind: "artifact-immutability",
        proven: true,
        evidenceHash: VALID_SHA,
        description: "immutability proven",
      },
      {
        kind: "grant-enforcement",
        proven: true,
        evidenceHash: VALID_SHA,
        description: "grant proven",
      },
      {
        kind: "egress-controls",
        proven: true,
        evidenceHash: VALID_SHA,
        description: "egress proven",
      },
      {
        kind: "resource-limits",
        proven: true,
        evidenceHash: VALID_SHA,
        description: "limits proven",
      },
      {
        kind: "secret-non-inheritance",
        proven: true,
        evidenceHash: VALID_SHA,
        description: "secret proven",
      },
      { kind: "teardown", proven: true, evidenceHash: VALID_SHA, description: "teardown proven" },
      {
        kind: "crash-recovery",
        proven: true,
        evidenceHash: VALID_SHA,
        description: "crash proven",
      },
      {
        kind: "concurrent-workload-separation",
        proven: true,
        evidenceHash: VALID_SHA,
        description: "separation proven",
      },
      {
        kind: "bridge-confusion-replay",
        proven: true,
        evidenceHash: VALID_SHA,
        description: "bridge proven",
      },
      {
        kind: "host-compromise-assumptions",
        proven: true,
        evidenceHash: VALID_SHA,
        description: "host proven",
      },
    ],
    unsupported: [],
  };
}

function makeAdapter(overrides: Partial<IsolationAdapterV1> = {}): IsolationAdapterV1 {
  return {
    schema: "werkstatt/isolation-adapter@1",
    adapterId: "test-adapter",
    properties: makeFullProperties(),
    create: async () => ({
      workloadId: "wl-1",
      invoke: async () => ({
        schema: "werkstatt/capability-bridge-response@1",
        requestId: "req-1",
        status: "ok" as const,
        payload: new Uint8Array(),
        diagnostics: [],
      }),
      terminate: async () => ({
        schema: "werkstatt/termination-report@1",
        workloadId: "wl-1",
        reason: "test",
        terminated: true,
        quarantined: false,
        diagnostics: [],
      }),
    }),
    ...overrides,
  };
}

function makeGrantSet(): AttenuatedGrantSetV1 {
  return {
    schema: "werkstatt/attenuated-grant-set@1",
    grants: [{ scope: "read", resource: "test", maxDuration: 1000, maxOperations: 10 }],
    grantSetHash: VALID_SHA,
  };
}

function makeBridgeRequest(
  overrides: Partial<CapabilityBridgeRequestV1> = {},
): CapabilityBridgeRequestV1 {
  return {
    schema: "werkstatt/capability-bridge-request@1",
    requestId: "req-1",
    capability: "werkstatt/kernel" as `${string}/${string}`,
    grant: { scope: "read", resource: "test", maxDuration: 1000, maxOperations: 10 },
    payload: new Uint8Array([1, 2, 3]),
    deadline: 5000,
    ...overrides,
  };
}

function makeFixture(
  overrides: Partial<IsolationConformanceFixtureV1> = {},
): IsolationConformanceFixtureV1 {
  return {
    fixtureId: "test-fixture",
    fixtureHash: VALID_SHA,
    adapter: makeAdapter(),
    cases: [],
    ...overrides,
  };
}

describe("isolation schemas", () => {
  it("validates a correct adapter", () => {
    const result = validateIsolationAdapter(makeAdapter());
    expect(result.status).toBe("pass");
    expect(result.violations).toHaveLength(0);
  });

  it("rejects adapter with unknown field", () => {
    const adapter = { ...makeAdapter(), extraField: "evil" } as unknown as IsolationAdapterV1;
    const result = validateIsolationAdapter(adapter);
    expect(result.status).toBe("fail");
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("rejects adapter with wrong schema", () => {
    const adapter = {
      ...makeAdapter(),
      schema: "werkstatt/wrong@1",
    } as unknown as IsolationAdapterV1;
    const result = validateIsolationAdapter(adapter);
    expect(result.status).toBe("fail");
  });

  it("rejects adapter with invalid adapterId (empty)", () => {
    const adapter = { ...makeAdapter(), adapterId: "" };
    const result = validateIsolationAdapter(adapter);
    expect(result.status).toBe("fail");
  });

  it("validates a correct bridge request", () => {
    const result = validateBridgeRequest(makeBridgeRequest());
    expect(result.status).toBe("pass");
    expect(result.violations).toHaveLength(0);
  });

  it("rejects bridge request with unknown field", () => {
    const req = {
      ...makeBridgeRequest(),
      ambientFs: "/etc/passwd",
    } as unknown as CapabilityBridgeRequestV1;
    const result = validateBridgeRequest(req);
    expect(result.status).toBe("fail");
  });

  it("rejects bridge request with invalid capability format", () => {
    const req = { ...makeBridgeRequest(), capability: "invalid-no-slash" as `${string}/${string}` };
    const result = validateBridgeRequest(req);
    expect(result.status).toBe("fail");
  });

  it("rejects bridge request with zero deadline", () => {
    const req = { ...makeBridgeRequest(), deadline: 0 };
    const result = validateBridgeRequest(req);
    expect(result.status).toBe("fail");
  });

  it("validates a correct attenuated grant set", () => {
    const result = attenuatedGrantSetV1Schema.safeParse(makeGrantSet());
    expect(result.success).toBe(true);
  });

  it("rejects attenuated grant set with unknown field", () => {
    const gs = { ...makeGrantSet(), extra: true } as unknown as AttenuatedGrantSetV1;
    const result = attenuatedGrantSetV1Schema.safeParse(gs);
    expect(result.success).toBe(false);
  });

  it("rejects attenuated grant set with invalid hash", () => {
    const gs = { ...makeGrantSet(), grantSetHash: "not-a-hash" } as unknown as AttenuatedGrantSetV1;
    const result = attenuatedGrantSetV1Schema.safeParse(gs);
    expect(result.success).toBe(false);
  });

  it("validates a correct conformance result", () => {
    const result: IsolationConformanceResultV1 = createConformanceResult(
      "test-adapter",
      VALID_SHA,
      VALID_SHA,
      VALID_SHA,
      [],
      [],
      "pass",
    );
    const parsed = isolationConformanceResultV1Schema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it("rejects conformance result with testOnly: false", () => {
    const result = {
      ...createConformanceResult("test-adapter", VALID_SHA, VALID_SHA, VALID_SHA, [], [], "pass"),
      testOnly: false,
    } as unknown as IsolationConformanceResultV1;
    const parsed = isolationConformanceResultV1Schema.safeParse(result);
    expect(parsed.success).toBe(false);
  });

  it("rejects conformance result with unknown field", () => {
    const result = {
      ...createConformanceResult("test-adapter", VALID_SHA, VALID_SHA, VALID_SHA, [], [], "pass"),
      admission: true,
    } as unknown as IsolationConformanceResultV1;
    const parsed = isolationConformanceResultV1Schema.safeParse(result);
    expect(parsed.success).toBe(false);
  });
});

describe("runIsolationConformance", () => {
  it("returns pass for a fully-proven adapter with all cases", () => {
    const fixture = makeFixture();
    const result = runIsolationConformance(fixture, { now: () => 0 });
    expect(result.status).toBe("pass");
    expect(result.violations).toHaveLength(0);
    expect(result.testOnly).toBe(true);
    expect(result.cases).toHaveLength(12);
  });

  it("returns fail for vm-theatre case", () => {
    const fixture = makeFixture({
      cases: ["vm-theatre"],
    });
    const result = runIsolationConformance(fixture, { now: () => 0 });
    expect(result.status).toBe("fail");
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]!.caseKind).toBe("vm-theatre");
    expect(result.cases[0]!.passed).toBe(false);
  });

  it("returns fail for worker-threads-theatre case", () => {
    const fixture = makeFixture({
      cases: ["worker-threads-theatre"],
    });
    const result = runIsolationConformance(fixture, { now: () => 0 });
    expect(result.status).toBe("fail");
    expect(result.cases[0]!.caseKind).toBe("worker-threads-theatre");
    expect(result.cases[0]!.passed).toBe(false);
  });

  it("returns fail for subprocess-theatre case", () => {
    const fixture = makeFixture({
      cases: ["subprocess-theatre"],
    });
    const result = runIsolationConformance(fixture, { now: () => 0 });
    expect(result.status).toBe("fail");
    expect(result.cases[0]!.caseKind).toBe("subprocess-theatre");
    expect(result.cases[0]!.passed).toBe(false);
  });

  it("returns incomplete when required property is missing", () => {
    const incompleteProperties: IsolationPropertyEvidenceV1 = {
      ...makeFullProperties(),
      properties: makeFullProperties().properties.filter((p) => p.kind !== "containment"),
    };
    const fixture = makeFixture({
      adapter: makeAdapter({ properties: incompleteProperties }),
    });
    const result = runIsolationConformance(fixture, { now: () => 0 });
    expect(result.status).toBe("incomplete");
    expect(result.violations.some((v) => v.includes("containment"))).toBe(true);
  });

  it("returns incomplete when property is marked unsupported", () => {
    const unsupportedProperties: IsolationPropertyEvidenceV1 = {
      ...makeFullProperties(),
      properties: makeFullProperties().properties.filter((p) => p.kind !== "teardown"),
      unsupported: ["teardown"],
    };
    const fixture = makeFixture({
      adapter: makeAdapter({ properties: unsupportedProperties }),
    });
    const result = runIsolationConformance(fixture, { now: () => 0 });
    expect(result.status).toBe("incomplete");
    expect(result.violations.some((v) => v.includes("teardown"))).toBe(true);
  });

  it("returns incomplete when property is unproven", () => {
    const unprovenProperties: IsolationPropertyEvidenceV1 = {
      ...makeFullProperties(),
      properties: makeFullProperties().properties.map((p) =>
        p.kind === "egress-controls" ? { ...p, proven: false } : p,
      ),
    };
    const fixture = makeFixture({
      adapter: makeAdapter({ properties: unprovenProperties }),
    });
    const result = runIsolationConformance(fixture, { now: () => 0 });
    expect(result.status).toBe("incomplete");
  });

  it("result always has testOnly: true", () => {
    const fixture = makeFixture();
    const result = runIsolationConformance(fixture, { now: () => 0 });
    expect(result.testOnly).toBe(true);
  });

  it("result contains no admission or promotion decision", () => {
    const fixture = makeFixture();
    const result = runIsolationConformance(fixture, { now: () => 0 });
    const keys = Object.keys(result);
    expect(keys).not.toContain("admission");
    expect(keys).not.toContain("promotion");
    expect(keys).not.toContain("certified");
    expect(keys).not.toContain("authority");
  });

  it("runs specific cases when provided", () => {
    const fixture = makeFixture({
      cases: ["filesystem-escape", "network-escape"],
    });
    const result = runIsolationConformance(fixture, { now: () => 0 });
    expect(result.cases).toHaveLength(2);
    expect(result.cases[0]!.caseKind).toBe("filesystem-escape");
    expect(result.cases[1]!.caseKind).toBe("network-escape");
    expect(result.status).toBe("pass");
  });

  it("adapter with empty properties returns incomplete", () => {
    const emptyProperties: IsolationPropertyEvidenceV1 = {
      schema: "werkstatt/isolation-property-evidence@1",
      properties: [],
      unsupported: [],
    };
    const fixture = makeFixture({
      adapter: makeAdapter({ properties: emptyProperties }),
    });
    const result = runIsolationConformance(fixture, { now: () => 0 });
    expect(result.status).toBe("incomplete");
  });
});

describe("createConformanceResult", () => {
  it("creates a result with correct schema", () => {
    const result = createConformanceResult(
      "adapter-1",
      VALID_SHA,
      VALID_SHA_2,
      VALID_SHA,
      [],
      [],
      "pass",
    );
    expect(result.schema).toBe("werkstatt/isolation-conformance-result@1");
    expect(result.adapterId).toBe("adapter-1");
    expect(result.testOnly).toBe(true);
  });

  it("creates a fail result with violations", () => {
    const result = createConformanceResult(
      "adapter-1",
      VALID_SHA,
      VALID_SHA_2,
      VALID_SHA,
      [],
      ["ISOLATION-REJECTED: vm-theatre"],
      "fail",
    );
    expect(result.status).toBe("fail");
    expect(result.violations).toHaveLength(1);
  });
});
