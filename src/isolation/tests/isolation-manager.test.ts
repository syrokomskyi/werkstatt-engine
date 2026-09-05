/*
<MODULE_CONTRACT>
<purpose>RFC-1035: unit tests for IsolationManager and CapabilityBridge.
  Covers AC-1 through AC-11 plus edge cases (ISOLATION-06, 07, 08).</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-1035: initial test suite for isolation manager and capability bridge.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach } from "vitest";
import {
  createIsolationManager,
  type AdmittedProvider,
  type SandboxLifecycleEvent,
} from "../isolation-manager.ts";
import { createCapabilityBridge } from "../capability-bridge.ts";
import { createCapabilityBroker } from "../broker/broker.ts";
import { createFakeSandboxAdapter } from "../providers/fake-sandbox.ts";
import type {
  ComponentId,
  CapabilityId,
  IsolationTier,
  GrantScope,
} from "../../component/contracts.ts";
import type { IsolationPolicy } from "../contracts.ts";

const COMPONENT_ID = "werkstatt/test" as ComponentId;
const FAKE_ADAPTER_ID = "fake-sandbox-adapter";

function makePolicy(
  tier: IsolationTier,
  overrides: Partial<IsolationPolicy> = {},
): IsolationPolicy {
  return {
    tier,
    fsReadPaths: ["/tmp/test"],
    fsWritePaths: ["/tmp/test-out"],
    networkHosts: [],
    grantedCommands: ["compute/run" as CapabilityId],
    timeoutMs: 5000,
    memoryLimitBytes: 256 * 1024 * 1024,
    cpuLimitPercent: 50,
    ...overrides,
  };
}

function makeProviders(): AdmittedProvider[] {
  return [
    { adapter: createFakeSandboxAdapter(), tier: 1 },
    { adapter: createFakeSandboxAdapter(), tier: 2 },
  ];
}

describe("IsolationManager", () => {
  let events: SandboxLifecycleEvent[];

  beforeEach(() => {
    events = [];
  });

  it("AC-1: getTier returns 0 for unregistered component", () => {
    const mgr = createIsolationManager(makeProviders());
    expect(mgr.getTier(COMPONENT_ID)).toBe(0);
  });

  it("AC-1: assignTier persists tier assignment", () => {
    const mgr = createIsolationManager(makeProviders());
    mgr.assignTier(COMPONENT_ID, 2);
    expect(mgr.getTier(COMPONENT_ID)).toBe(2);
  });

  it("AC-2: spawn creates sandbox with admitted provider at tier 2", async () => {
    const mgr = createIsolationManager(makeProviders(), {
      onSandboxEvent: (e) => events.push(e),
    });
    const handle = await mgr.spawn(COMPONENT_ID, 2, makePolicy(2));
    expect(handle.sandboxId).toBeTruthy();
    expect(handle.state).toBe("active");
    expect(handle.tier).toBe(2);
    expect(handle.componentId).toBe(COMPONENT_ID);
  });

  it("AC-3: spawn returns SandboxHandle with state active", async () => {
    const mgr = createIsolationManager(makeProviders());
    const handle = await mgr.spawn(COMPONENT_ID, 1, makePolicy(1));
    expect(handle.state).toBe("active");
    expect(handle.health).toBe("healthy");
  });

  it("AC-3: inspect returns the spawned sandbox handle", async () => {
    const mgr = createIsolationManager(makeProviders());
    const handle = await mgr.spawn(COMPONENT_ID, 1, makePolicy(1));
    const inspected = mgr.inspect(handle.sandboxId);
    expect(inspected).not.toBeNull();
    expect(inspected!.sandboxId).toBe(handle.sandboxId);
  });

  it("AC-10: terminate releases sandbox resources", async () => {
    const mgr = createIsolationManager(makeProviders(), {
      onSandboxEvent: (e) => events.push(e),
    });
    const handle = await mgr.spawn(COMPONENT_ID, 1, makePolicy(1));
    const report = await mgr.terminate(handle.sandboxId, "test-done");
    expect(report.terminated).toBe(true);
    expect(mgr.inspect(handle.sandboxId)).toBeNull();
  });

  it("AC-10: terminate records lifecycle event", async () => {
    const mgr = createIsolationManager(makeProviders(), {
      onSandboxEvent: (e) => events.push(e),
    });
    const handle = await mgr.spawn(COMPONENT_ID, 1, makePolicy(1));
    await mgr.terminate(handle.sandboxId, "test-done");
    const terminateEvent = events.find((e) => e.type === "terminate");
    expect(terminateEvent).toBeDefined();
    expect(terminateEvent!.reason).toBe("test-done");
  });

  it("AC-11: spawn records lifecycle event", async () => {
    const mgr = createIsolationManager(makeProviders(), {
      onSandboxEvent: (e) => events.push(e),
    });
    await mgr.spawn(COMPONENT_ID, 1, makePolicy(1));
    const spawnEvent = events.find((e) => e.type === "spawn");
    expect(spawnEvent).toBeDefined();
    expect(spawnEvent!.componentId).toBe(COMPONENT_ID);
    expect(spawnEvent!.tier).toBe(1);
  });

  it("ISOLATION-06: Tier 0 assignment requires human approval", () => {
    const mgr = createIsolationManager(makeProviders());
    expect(() => mgr.assignTier(COMPONENT_ID, 0)).toThrow(/ISOLATION-06/);
  });

  it("ISOLATION-06: Tier 0 spawn requires human approval", async () => {
    const mgr = createIsolationManager(makeProviders());
    await expect(mgr.spawn(COMPONENT_ID, 0, makePolicy(0))).rejects.toThrow(/ISOLATION-06/);
  });

  it("ISOLATION-07: no admitted provider for tier 3", async () => {
    const mgr = createIsolationManager(makeProviders());
    await expect(mgr.spawn(COMPONENT_ID, 3, makePolicy(3))).rejects.toThrow(/ISOLATION-07/);
  });

  it("ISOLATION-08: sensitive path in fsReadPaths is rejected", async () => {
    const mgr = createIsolationManager(makeProviders());
    const policy = makePolicy(1, { fsReadPaths: ["/app/.env"] });
    await expect(mgr.spawn(COMPONENT_ID, 1, policy)).rejects.toThrow(/ISOLATION-08/);
  });

  it("ISOLATION-08: sensitive path in fsWritePaths is rejected", async () => {
    const mgr = createIsolationManager(makeProviders());
    const policy = makePolicy(1, { fsWritePaths: ["/app/secret.key"] });
    await expect(mgr.spawn(COMPONENT_ID, 1, policy)).rejects.toThrow(/ISOLATION-08/);
  });

  it("ISOLATION-08: system-state.yaml path is rejected", async () => {
    const mgr = createIsolationManager(makeProviders());
    const policy = makePolicy(1, { fsReadPaths: ["/cache/system-state.yaml"] });
    await expect(mgr.spawn(COMPONENT_ID, 1, policy)).rejects.toThrow(/ISOLATION-08/);
  });

  it("ISOLATION-04: max sandbox count enforced", async () => {
    const mgr = createIsolationManager(makeProviders(), { maxSandboxes: 1 });
    await mgr.spawn(COMPONENT_ID, 1, makePolicy(1));
    await expect(mgr.spawn("other/test" as ComponentId, 1, makePolicy(1))).rejects.toThrow(
      /ISOLATION-04/,
    );
  });

  it("list returns all active sandboxes", async () => {
    const mgr = createIsolationManager(makeProviders());
    await mgr.spawn(COMPONENT_ID, 1, makePolicy(1));
    await mgr.spawn("other/test" as ComponentId, 2, makePolicy(2));
    expect(mgr.list()).toHaveLength(2);
  });
});

describe("CapabilityBridge", () => {
  function makeBrokerContext() {
    const broker = createCapabilityBroker();
    broker.registerCapability("compute/run" as CapabilityId, async () => ({
      schema: "werkstatt/capability-bridge-response@1",
      requestId: "test",
      status: "ok",
      payload: new Uint8Array(0),
      diagnostics: [],
    }));
    const grantSetHash = ("sha256:" + "0".repeat(64)) as never;
    return {
      broker,
      context: {
        callerId: "test-caller",
        workloadId: "wl-test",
        artifactHash: grantSetHash,
        grantSet: {
          schema: "werkstatt/attenuated-grant-set@1" as const,
          grants: [
            {
              scope: "read" as GrantScope,
              resource: "sandbox",
              maxDuration: 5000,
              maxOperations: 100,
            },
          ],
          grantSetHash,
        },
        policy: {
          schema: "werkstatt/broker-policy@1" as const,
          policyId: "test-policy",
          version: "1.0.0",
          allowedCapabilities: ["compute/run" as CapabilityId],
          maxRequestBytes: 65536,
          maxResponseBytes: 65536,
          defaultTimeoutMs: 5000,
          maxConcurrentRequests: 10,
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  it("AC-4: command not in grantedCommands is denied with ISOLATION-01", async () => {
    const { broker, context } = makeBrokerContext();
    const policy = makePolicy(1, { grantedCommands: ["compute/run" as CapabilityId] });
    const bridge = createCapabilityBridge({
      sandboxId: "sb-test",
      broker,
      policy,
      brokerContext: context,
    });
    const response = await bridge.call("fs/read" as CapabilityId, new Uint8Array(0));
    expect(response.status).toBe("denied");
    expect(response.diagnostics[0]).toMatch(/ISOLATION-01/);
  });

  it("AC-5: command not in grantedCommands triggers ISOLATION-01", async () => {
    const { broker, context } = makeBrokerContext();
    const policy = makePolicy(1, { grantedCommands: [] });
    const bridge = createCapabilityBridge({
      sandboxId: "sb-test",
      broker,
      policy,
      brokerContext: context,
    });
    const response = await bridge.call("compute/run" as CapabilityId, new Uint8Array(0));
    expect(response.status).toBe("denied");
    expect(response.diagnostics[0]).toMatch(/ISOLATION-01/);
  });

  it("AC-6: timeout exceeds timeoutMs triggers ISOLATION-02", async () => {
    const { broker, context } = makeBrokerContext();
    const slowBroker: typeof broker = {
      ...broker,
      invoke: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              schema: "werkstatt/capability-bridge-response@1",
              requestId: "slow",
              status: "ok",
              payload: new Uint8Array(0),
              diagnostics: [],
            });
          }, 300);
        }),
    };
    const policy = makePolicy(1, {
      grantedCommands: ["compute/run" as CapabilityId],
      timeoutMs: 50,
    });
    const bridge = createCapabilityBridge({
      sandboxId: "sb-test",
      broker: slowBroker,
      policy,
      brokerContext: context,
    });
    const response = await bridge.call("compute/run" as CapabilityId, new Uint8Array(0));
    expect(response.status).toBe("timeout");
    expect(response.diagnostics[0]).toMatch(/ISOLATION-02/);
  });

  it("granted command succeeds via broker", async () => {
    const { broker, context } = makeBrokerContext();
    const policy = makePolicy(1, { grantedCommands: ["compute/run" as CapabilityId] });
    const bridge = createCapabilityBridge({
      sandboxId: "sb-test",
      broker,
      policy,
      brokerContext: context,
    });
    const response = await bridge.call("compute/run" as CapabilityId, new Uint8Array(0));
    expect(response.status).toBe("ok");
  });

  it("ping returns true for active bridge", async () => {
    const { broker, context } = makeBrokerContext();
    const bridge = createCapabilityBridge({
      sandboxId: "sb-test",
      broker,
      policy: makePolicy(1),
      brokerContext: context,
    });
    expect(await bridge.ping()).toBe(true);
  });

  it("ping returns false after terminate", async () => {
    const { broker, context } = makeBrokerContext();
    const bridge = createCapabilityBridge({
      sandboxId: "sb-test",
      broker,
      policy: makePolicy(1),
      brokerContext: context,
    });
    await bridge.terminate("test");
    expect(await bridge.ping()).toBe(false);
  });

  it("violation threshold (3 within 60s) triggers auto-terminate", async () => {
    const { broker, context } = makeBrokerContext();
    let terminated = false;
    const policy = makePolicy(1, { grantedCommands: [] });
    const bridge = createCapabilityBridge({
      sandboxId: "sb-test",
      broker,
      policy,
      brokerContext: context,
      onTerminate: () => {
        terminated = true;
      },
    });
    await bridge.call("fs/read" as CapabilityId, new Uint8Array(0));
    await bridge.call("fs/read" as CapabilityId, new Uint8Array(0));
    await bridge.call("fs/read" as CapabilityId, new Uint8Array(0));
    expect(terminated).toBe(true);
    expect(await bridge.ping()).toBe(false);
  });

  it("call after termination returns error", async () => {
    const { broker, context } = makeBrokerContext();
    const bridge = createCapabilityBridge({
      sandboxId: "sb-test",
      broker,
      policy: makePolicy(1),
      brokerContext: context,
    });
    await bridge.terminate("test");
    const response = await bridge.call("compute/run" as CapabilityId, new Uint8Array(0));
    expect(response.status).toBe("error");
  });
});
