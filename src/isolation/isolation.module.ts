/*
<MODULE_CONTRACT>
<purpose>RFC-1035: registers isolation.* kernel commands for component
  isolation and sandboxing tiers. 6 commands covering tier inspection,
  tier assignment, sandbox spawn/inspect/terminate, and capability bridging.</purpose>
<non-goals>
  <item>Does not implement isolation logic — that lives in isolation-manager.ts.</item>
  <item>Does not register non-isolation commands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-1035: initial implementation — registers 6 isolation.* commands.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "../kernel/types.ts";

export function createIsolationModule(): KernelModule {
  return {
    name: "isolation",
    version: "0.1.0",

    async register(registry) {
      const {
        runTierInspect,
        runTierAssign,
        runSandboxSpawn,
        runSandboxInspect,
        runSandboxTerminate,
        runCapabilityBridge,
      } = await import("./isolation-commands.ts");

      const modulePath = "packages/werkstatt-engine/src/isolation/isolation.module.ts";

      registry.registerCommand({
        name: "isolation.tier.inspect",
        modulePath,
        description:
          "Inspect the isolation tier of registered components. " +
          "Optional --component-id to inspect a single component (RFC-1035).",
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        generates: [],
        flags: {
          "component-id": { kind: "string", description: "Component ID to inspect." },
        },
        execute: runTierInspect,
      });

      registry.registerCommand({
        name: "isolation.tier.assign",
        modulePath,
        description:
          "Assign an isolation tier to a component. " +
          "Tier 0 requires human approval (ISOLATION-06). " +
          "Requires --component-id and --tier (RFC-1035).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "component-id": { kind: "string", description: "Component ID to assign." },
          "tier": { kind: "string", description: "Isolation tier (0, 1, 2, or 3)." },
        },
        execute: runTierAssign,
      });

      registry.registerCommand({
        name: "isolation.sandbox.spawn",
        modulePath,
        description:
          "Spawn a sandbox for a component at the specified isolation tier. " +
          "Requires --component-id, --tier, and policy flags (RFC-1035).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "component-id": { kind: "string", description: "Component ID to sandbox." },
          "tier": { kind: "string", description: "Isolation tier (1, 2, or 3)." },
          "fs-read-paths": { kind: "string", description: "Comma-separated filesystem read paths." },
          "fs-write-paths": { kind: "string", description: "Comma-separated filesystem write paths." },
          "network-hosts": { kind: "string", description: "Comma-separated allowed network hosts." },
          "granted-commands": { kind: "string", description: "Comma-separated granted capability commands." },
          "timeout-ms": { kind: "string", description: "Call timeout in milliseconds (default: 30000)." },
          "memory-limit-bytes": { kind: "string", description: "Memory limit in bytes (default: 256MB)." },
          "cpu-limit-percent": { kind: "string", description: "CPU limit percent (default: 50)." },
        },
        execute: runSandboxSpawn,
      });

      registry.registerCommand({
        name: "isolation.sandbox.inspect",
        modulePath,
        description:
          "Inspect a sandbox's health, resource usage, and state. " +
          "Requires --sandbox-id (RFC-1035).",
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        generates: [],
        flags: {
          "sandbox-id": { kind: "string", description: "Sandbox ID to inspect." },
        },
        execute: runSandboxInspect,
      });

      registry.registerCommand({
        name: "isolation.sandbox.terminate",
        modulePath,
        description:
          "Terminate a sandbox and release its resources. " +
          "Requires --sandbox-id. Optional --reason (RFC-1035).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "sandbox-id": { kind: "string", description: "Sandbox ID to terminate." },
          "reason": { kind: "string", description: "Termination reason (default: manual)." },
        },
        execute: runSandboxTerminate,
      });

      registry.registerCommand({
        name: "isolation.capability.bridge",
        modulePath,
        description:
          "Create a capability bridge for a sandbox, enabling policy-enforced " +
          "communication between the host and the sandboxed component. " +
          "Requires --sandbox-id (RFC-1035).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "sandbox-id": { kind: "string", description: "Sandbox ID to bridge." },
        },
        execute: runCapabilityBridge,
      });
    },
  };
}
