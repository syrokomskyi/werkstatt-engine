import { describe, it, expect } from "vitest";
import {
  createInMemoryArtifactStore,
  createProviderAdmissionStore,
} from "../capability-artifacts/index.ts";
import type {
  ArtifactPublishRequestV1,
  ArtifactProvenanceV1,
  SandboxProviderAdmissionV1,
} from "../capability-artifacts/index.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import { createCapabilityBroker } from "../isolation/broker/index.ts";
import type { BrokerPolicyV1, BrokerInvocationContextV1 } from "../isolation/broker/index.ts";
import {
  createFakeSandboxAdapter,
  getFakeAdapterId,
  getFakePropertyEvidence,
} from "../isolation/providers/fake-sandbox.ts";
import type {
  AttenuatedGrantSetV1,
  AttenuatedGrantV1,
  CapabilityBridgeRequestV1,
} from "../isolation/contracts.ts";

const D =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as string as Sha256Digest;
const D1 =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111" as string as Sha256Digest;
const D2 =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222" as string as Sha256Digest;
const TS = "2026-08-15T12:00:00Z";

function mkProvenance(): ArtifactProvenanceV1 {
  return {
    schema: "werkstatt/artifact-provenance@1",
    sourceCommit: "abc123",
    buildCommand: "pnpm build",
    builderId: "builder-001",
    builtAt: TS,
    reproducible: true,
  };
}

function mkPublishRequest(
  payload: Uint8Array = new TextEncoder().encode("test-payload"),
): ArtifactPublishRequestV1 {
  return {
    manifestBytes: new TextEncoder().encode('{"version":"1.0.0"}'),
    payloadBytes: payload,
    mediaType: "application/vnd.werkstatt.capability+binary",
    provenance: mkProvenance(),
  };
}

function mkGrantSet(): AttenuatedGrantSetV1 {
  const grant: AttenuatedGrantV1 = {
    scope: "read",
    resource: "test-resource",
    maxDuration: 5000,
    maxOperations: 100,
  };
  return {
    schema: "werkstatt/attenuated-grant-set@1",
    grants: [grant],
    grantSetHash: D,
  };
}

describe("createInMemoryArtifactStore", () => {
  it("publishes a valid artifact", () => {
    const store = createInMemoryArtifactStore();
    const result = store.publish(mkPublishRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.schema).toBe("werkstatt/capability-artifact@1");
      expect(result.artifact.sizeBytes).toBe(12);
      expect(result.artifact.mediaType).toBe("application/vnd.werkstatt.capability+binary");
    }
  });

  it("rejects oversized artifact", () => {
    const store = createInMemoryArtifactStore();
    const huge = new Uint8Array(257 * 1024 * 1024);
    const result = store.publish(mkPublishRequest(huge));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ARTIFACT-01");
    }
  });

  it("rejects unallowed media type", () => {
    const store = createInMemoryArtifactStore();
    const result = store.publish({
      ...mkPublishRequest(),
      mediaType: "text/plain",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ARTIFACT-02");
    }
  });

  it("rejects duplicate artifact (immutability)", () => {
    const store = createInMemoryArtifactStore();
    store.publish(mkPublishRequest());
    const result = store.publish(mkPublishRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ARTIFACT-03");
    }
  });

  it("retrieves published artifact by hash", () => {
    const store = createInMemoryArtifactStore();
    const pub = store.publish(mkPublishRequest());
    if (!pub.ok) throw new Error("publish failed");
    const artifact = store.get(pub.artifact.artifactHash);
    expect(artifact).not.toBeNull();
    expect(artifact?.artifactHash).toBe(pub.artifact.artifactHash);
  });

  it("verifies artifact payload matches", () => {
    const store = createInMemoryArtifactStore();
    const payload = new TextEncoder().encode("verify-test");
    const pub = store.publish(mkPublishRequest(payload));
    if (!pub.ok) throw new Error("publish failed");
    const result = store.verify(pub.artifact.artifactHash, payload);
    expect(result.ok).toBe(true);
  });

  it("rejects verification on hash mismatch", () => {
    const store = createInMemoryArtifactStore();
    const pub = store.publish(mkPublishRequest());
    if (!pub.ok) throw new Error("publish failed");
    const result = store.verify(
      pub.artifact.artifactHash,
      new TextEncoder().encode("wrong-payload"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ARTIFACT-05");
    }
  });

  it("rejects verification on missing artifact", () => {
    const store = createInMemoryArtifactStore();
    const result = store.verify(D, new TextEncoder().encode("test"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ARTIFACT-04");
    }
  });

  it("lists published artifact hashes", () => {
    const store = createInMemoryArtifactStore();
    store.publish(mkPublishRequest(new TextEncoder().encode("a")));
    store.publish(mkPublishRequest(new TextEncoder().encode("b")));
    expect(store.list()).toHaveLength(2);
  });
});

describe("createProviderAdmissionStore", () => {
  function mkAdmission(
    decision: "pass" | "fail" | "incomplete" = "pass",
  ): SandboxProviderAdmissionV1 {
    return {
      schema: "werkstatt/sandbox-provider-admission@1",
      adapterId: "adapter-001",
      adapterVersion: "1.0.0",
      conformanceHash: D,
      policyHash: D1,
      decision,
    };
  }

  it("admits a passing provider", () => {
    const store = createProviderAdmissionStore();
    const result = store.admit(mkAdmission("pass"));
    expect(result.ok).toBe(true);
    expect(store.isAdmitted("adapter-001")).toBe(true);
  });

  it("rejects non-pass admission", () => {
    const store = createProviderAdmissionStore();
    const result = store.admit(mkAdmission("fail"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ARTIFACT-06");
    }
  });

  it("rejects incomplete admission", () => {
    const store = createProviderAdmissionStore();
    const result = store.admit(mkAdmission("incomplete"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ARTIFACT-06");
    }
  });

  it("rejects stale conformance hash change", () => {
    const store = createProviderAdmissionStore();
    store.admit(mkAdmission("pass"));
    const result = store.admit({
      ...mkAdmission("pass"),
      conformanceHash: D2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ARTIFACT-07");
    }
  });

  it("re-admits same conformance hash (idempotent)", () => {
    const store = createProviderAdmissionStore();
    store.admit(mkAdmission("pass"));
    const result = store.admit(mkAdmission("pass"));
    expect(result.ok).toBe(true);
  });

  it("returns null for unregistered adapter", () => {
    const store = createProviderAdmissionStore();
    expect(store.get("unknown")).toBeNull();
  });
});

describe("createCapabilityBroker", () => {
  function mkPolicy(allowed: string[] = ["compute/run"]): BrokerPolicyV1 {
    return {
      schema: "werkstatt/broker-policy@1",
      policyId: "policy-001",
      version: "1.0.0",
      allowedCapabilities: allowed as unknown as BrokerPolicyV1["allowedCapabilities"][0][],
      maxRequestBytes: 1024,
      maxResponseBytes: 4096,
      defaultTimeoutMs: 5000,
      maxConcurrentRequests: 4,
    };
  }

  function mkContext(policy: BrokerPolicyV1): BrokerInvocationContextV1 {
    return {
      callerId: "caller-001",
      workloadId: "wl-001",
      artifactHash: D,
      grantSet: mkGrantSet(),
      policy,
      timestamp: TS,
    };
  }

  function mkRequest(capability: string = "compute/run"): CapabilityBridgeRequestV1 {
    return {
      schema: "werkstatt/capability-bridge-request@1",
      requestId: "req-001",
      capability: capability as CapabilityBridgeRequestV1["capability"],
      grant: {
        scope: "read",
        resource: "test-resource",
        maxDuration: 5000,
        maxOperations: 100,
      },
      payload: new TextEncoder().encode("test"),
      deadline: Date.now() + 5000,
    };
  }

  it("registers a capability", () => {
    const broker = createCapabilityBroker();
    const result = broker.registerCapability(
      "compute/run" as CapabilityBridgeRequestV1["capability"],
      async () => ({
        schema: "werkstatt/capability-bridge-response@1",
        requestId: "req-001",
        status: "ok",
        payload: new Uint8Array(0),
        diagnostics: [],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects ambient host capabilities", () => {
    const broker = createCapabilityBroker();
    const result = broker.registerCapability(
      "fs" as CapabilityBridgeRequestV1["capability"],
      async () => ({
        schema: "werkstatt/capability-bridge-response@1",
        requestId: "req-001",
        status: "ok",
        payload: new Uint8Array(0),
        diagnostics: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-BROKER-01");
    }
  });

  it("rejects duplicate capability registration", () => {
    const broker = createCapabilityBroker();
    const handler = async () => ({
      schema: "werkstatt/capability-bridge-response@1" as const,
      requestId: "req-001",
      status: "ok" as const,
      payload: new Uint8Array(0),
      diagnostics: [] as string[],
    });
    broker.registerCapability("compute/run" as CapabilityBridgeRequestV1["capability"], handler);
    const result = broker.registerCapability(
      "compute/run" as CapabilityBridgeRequestV1["capability"],
      handler,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-BROKER-02");
    }
  });

  it("invokes a registered capability successfully", async () => {
    const broker = createCapabilityBroker();
    broker.registerCapability(
      "compute/run" as CapabilityBridgeRequestV1["capability"],
      async (req) => ({
        schema: "werkstatt/capability-bridge-response@1",
        requestId: req.requestId,
        status: "ok",
        payload: new TextEncoder().encode("result"),
        diagnostics: [],
      }),
    );

    const response = await broker.invoke(mkRequest(), mkContext(mkPolicy()));
    expect(response.status).toBe("ok");
    expect(broker.auditLog()).toHaveLength(1);
  });

  it("denies capability not in policy", async () => {
    const broker = createCapabilityBroker();
    broker.registerCapability(
      "compute/run" as CapabilityBridgeRequestV1["capability"],
      async (req) => ({
        schema: "werkstatt/capability-bridge-response@1",
        requestId: req.requestId,
        status: "ok",
        payload: new Uint8Array(0),
        diagnostics: [],
      }),
    );

    const response = await broker.invoke(
      mkRequest("compute/run"),
      mkContext(mkPolicy(["other/cap"])),
    );
    expect(response.status).toBe("denied");
  });

  it("denies unregistered capability", async () => {
    const broker = createCapabilityBroker();
    const response = await broker.invoke(mkRequest(), mkContext(mkPolicy()));
    expect(response.status).toBe("denied");
  });

  it("denies capability without matching grant", async () => {
    const broker = createCapabilityBroker();
    broker.registerCapability(
      "compute/run" as CapabilityBridgeRequestV1["capability"],
      async (req) => ({
        schema: "werkstatt/capability-bridge-response@1",
        requestId: req.requestId,
        status: "ok",
        payload: new Uint8Array(0),
        diagnostics: [],
      }),
    );

    const grantSet: AttenuatedGrantSetV1 = {
      schema: "werkstatt/attenuated-grant-set@1",
      grants: [
        {
          scope: "read",
          resource: "other-resource",
          maxDuration: 5000,
          maxOperations: 100,
        },
      ],
      grantSetHash: D1,
    };

    const response = await broker.invoke(mkRequest(), { ...mkContext(mkPolicy()), grantSet });
    expect(response.status).toBe("denied");
  });

  it("denies oversized request", async () => {
    const broker = createCapabilityBroker();
    broker.registerCapability(
      "compute/run" as CapabilityBridgeRequestV1["capability"],
      async (req) => ({
        schema: "werkstatt/capability-bridge-response@1",
        requestId: req.requestId,
        status: "ok",
        payload: new Uint8Array(0),
        diagnostics: [],
      }),
    );

    const bigReq = {
      ...mkRequest(),
      payload: new Uint8Array(2048),
    };
    const response = await broker.invoke(bigReq, mkContext(mkPolicy()));
    expect(response.status).toBe("denied");
  });

  it("records audit entry for denied request", async () => {
    const broker = createCapabilityBroker();
    await broker.invoke(mkRequest(), mkContext(mkPolicy()));
    expect(broker.auditLog()).toHaveLength(1);
    expect(broker.auditLog()[0].status).toBe("denied");
  });

  it("lists registered capabilities", () => {
    const broker = createCapabilityBroker();
    broker.registerCapability(
      "compute/run" as CapabilityBridgeRequestV1["capability"],
      async () => ({
        schema: "werkstatt/capability-bridge-response@1",
        requestId: "req",
        status: "ok",
        payload: new Uint8Array(0),
        diagnostics: [],
      }),
    );
    expect(broker.registeredCapabilities()).toHaveLength(1);
  });
});

describe("createFakeSandboxAdapter", () => {
  it("creates adapter with correct id", () => {
    const adapter = createFakeSandboxAdapter();
    expect(adapter.adapterId).toBe(getFakeAdapterId());
  });

  it("proves all required properties", () => {
    const evidence = getFakePropertyEvidence();
    expect(evidence.properties).toHaveLength(12);
    expect(evidence.properties.every((p) => p.proven)).toBe(true);
    expect(evidence.unsupported).toHaveLength(0);
  });

  it("creates a sandboxed workload", async () => {
    const adapter = createFakeSandboxAdapter();
    const workload = await adapter.create({
      workloadId: "wl-001",
      artifactHash: D,
      grantSet: mkGrantSet(),
      limits: {
        maxMemoryBytes: 1024 * 1024,
        maxCpuTimeMs: 5000,
        maxWallTimeMs: 10000,
        maxConcurrency: 1,
        maxResponseBytes: 4096,
        maxRequestBytes: 1024,
      },
      bridgeSchemaHash: D1,
      idempotencyKey: "key-001",
    });
    expect(workload.workloadId).toBe("wl-001");
  });

  it("invokes and terminates workload", async () => {
    const adapter = createFakeSandboxAdapter();
    const workload = await adapter.create({
      workloadId: "wl-001",
      artifactHash: D,
      grantSet: mkGrantSet(),
      limits: {
        maxMemoryBytes: 1024 * 1024,
        maxCpuTimeMs: 5000,
        maxWallTimeMs: 10000,
        maxConcurrency: 1,
        maxResponseBytes: 4096,
        maxRequestBytes: 1024,
      },
      bridgeSchemaHash: D1,
      idempotencyKey: "key-001",
    });

    const response = await workload.invoke({
      schema: "werkstatt/capability-bridge-request@1",
      requestId: "req-001",
      capability: "compute/run" as CapabilityBridgeRequestV1["capability"],
      grant: {
        scope: "read",
        resource: "test-resource",
        maxDuration: 5000,
        maxOperations: 100,
      },
      payload: new TextEncoder().encode("test"),
      deadline: Date.now() + 5000,
    });
    expect(response.status).toBe("ok");

    const term = await workload.terminate("done");
    expect(term.terminated).toBe(true);
    expect(term.quarantined).toBe(false);
  });

  it("rejects invoke after terminate", async () => {
    const adapter = createFakeSandboxAdapter();
    const workload = await adapter.create({
      workloadId: "wl-001",
      artifactHash: D,
      grantSet: mkGrantSet(),
      limits: {
        maxMemoryBytes: 1024 * 1024,
        maxCpuTimeMs: 5000,
        maxWallTimeMs: 10000,
        maxConcurrency: 1,
        maxResponseBytes: 4096,
        maxRequestBytes: 1024,
      },
      bridgeSchemaHash: D1,
      idempotencyKey: "key-001",
    });

    await workload.terminate("done");
    const response = await workload.invoke({
      schema: "werkstatt/capability-bridge-request@1",
      requestId: "req-001",
      capability: "compute/run" as CapabilityBridgeRequestV1["capability"],
      grant: {
        scope: "read",
        resource: "test-resource",
        maxDuration: 5000,
        maxOperations: 100,
      },
      payload: new TextEncoder().encode("test"),
      deadline: Date.now() + 5000,
    });
    expect(response.status).toBe("error");
  });
});
