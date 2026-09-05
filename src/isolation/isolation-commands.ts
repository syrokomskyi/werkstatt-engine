/*
<MODULE_CONTRACT>
<purpose>RFC-1035: thin kernel command handlers for isolation.* commands.
  Each handler delegates to the IsolationManager and wraps the result
  in KernelCommandResult. Records bordbuch isolation events on lifecycle transitions.</purpose>
<non-goals>
  <item>Does not implement isolation logic — all logic lives in isolation-manager.ts.</item>
  <item>Does not register commands — registration lives in isolation.module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-1035: initial implementation — 6 isolation command handlers.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "../kernel/types.ts";
import type { ComponentId, IsolationTier, CapabilityId } from "../component/contracts.ts";
import {
  createIsolationManager,
  type AdmittedProvider,
  type SandboxLifecycleEvent,
} from "./isolation-manager.ts";
import type { IsolationManager, IsolationPolicy, SandboxHandle } from "./contracts.ts";
import { createFakeSandboxAdapter } from "./providers/fake-sandbox.ts";
import { appendBordbuchEntry } from "../bordbuch/bordbuch-io.ts";

let manager: IsolationManager | null = null;

function getManager(): IsolationManager {
  if (!manager) {
    const providers: AdmittedProvider[] = [
      { adapter: createFakeSandboxAdapter(), tier: 1 },
      { adapter: createFakeSandboxAdapter(), tier: 2 },
    ];
    manager = createIsolationManager(providers, {
      onSandboxEvent: (event: SandboxLifecycleEvent) => {
        // Bordbuch recording is handled in the command handlers where context is available
      },
    });
  }
  return manager;
}

function flagString(input: KernelCommandInput, name: string): string {
  const v = input.flags[name];
  return typeof v === "string" ? v : "";
}

function flagNumber(input: KernelCommandInput, name: string): number {
  const v = input.flags[name];
  return typeof v === "string" ? parseInt(v, 10) : 0;
}

function flagStringArray(input: KernelCommandInput, name: string): string[] {
  const v = input.flags[name];
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function recordIsolationEvent(context: KernelRuntimeContext, event: SandboxLifecycleEvent): void {
  const systemId = context.site?.name ?? "default";
  appendBordbuchEntry(
    context.workspaceRoot,
    systemId,
    "isolation",
    `Sandbox ${event.sandboxId} ${event.type} for ${event.componentId}`,
    "agent",
    {
      writerRole: "isolation",
      metadata: {
        sandboxId: event.sandboxId,
        tier: event.tier,
        componentId: event.componentId,
        action: event.type,
        reason: event.reason,
        crashReason: event.crashReason,
      },
    },
  )
    .then(() => undefined)
    .catch((err) => {
      context.logger.warn(`[isolation] Bordbuch event failed: ${(err as Error).message}`);
    });
}

function parsePolicy(input: KernelCommandInput): IsolationPolicy {
  const tier = flagNumber(input, "tier") as IsolationTier;
  return {
    tier,
    fsReadPaths: flagStringArray(input, "fs-read-paths"),
    fsWritePaths: flagStringArray(input, "fs-write-paths"),
    networkHosts: flagStringArray(input, "network-hosts"),
    grantedCommands: flagStringArray(input, "granted-commands") as CapabilityId[],
    timeoutMs: flagNumber(input, "timeout-ms") || 30_000,
    memoryLimitBytes: flagNumber(input, "memory-limit-bytes") || 256 * 1024 * 1024,
    cpuLimitPercent: flagNumber(input, "cpu-limit-percent") || 50,
  };
}

export async function runTierInspect(
  input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const mgr = getManager();
  const componentId = flagString(input, "component-id") as ComponentId;
  if (componentId) {
    const tier = mgr.getTier(componentId);
    return {
      data: { components: [{ componentId, tier }] },
      summary: `Component ${componentId} is at tier ${tier}`,
    };
  }
  return {
    data: { components: [] },
    summary: "No components registered",
  };
}

export async function runTierAssign(
  input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const mgr = getManager();
  const componentId = flagString(input, "component-id") as ComponentId;
  const tier = flagNumber(input, "tier") as IsolationTier;

  try {
    mgr.assignTier(componentId, tier);
    return {
      data: { componentId, tier },
      summary: `Assigned ${componentId} to tier ${tier}`,
    };
  } catch (err) {
    return {
      exitCode: 1,
      summary: `Failed to assign tier: ${(err as Error).message}`,
    };
  }
}

export async function runSandboxSpawn(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const mgr = getManager();
  const componentId = flagString(input, "component-id") as ComponentId;
  const tier = flagNumber(input, "tier") as IsolationTier;
  const policy = parsePolicy(input);

  try {
    const handle = await mgr.spawn(componentId, tier, policy);
    recordIsolationEvent(context, {
      type: "spawn",
      sandboxId: handle.sandboxId,
      componentId,
      tier,
    });
    return {
      data: { sandboxId: handle.sandboxId, state: "active", tier },
      summary: `Spawned sandbox ${handle.sandboxId} at tier ${tier}`,
    };
  } catch (err) {
    return {
      exitCode: 1,
      summary: `Spawn failed: ${(err as Error).message}`,
    };
  }
}

export async function runSandboxInspect(
  input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const mgr = getManager();
  const sandboxId = flagString(input, "sandbox-id");
  const handle = mgr.inspect(sandboxId);
  if (!handle) {
    return {
      exitCode: 1,
      summary: `Sandbox ${sandboxId} not found`,
    };
  }
  return {
    data: handle as SandboxHandle,
    summary: `Sandbox ${sandboxId}: state=${handle.state}, tier=${handle.tier}`,
  };
}

export async function runSandboxTerminate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const mgr = getManager();
  const sandboxId = flagString(input, "sandbox-id");
  const reason = flagString(input, "reason") || "manual";

  try {
    const handle = mgr.inspect(sandboxId);
    if (!handle) {
      return {
        exitCode: 1,
        summary: `Sandbox ${sandboxId} not found`,
      };
    }
    await mgr.terminate(sandboxId, reason);
    recordIsolationEvent(context, {
      type: "terminate",
      sandboxId,
      componentId: handle.componentId,
      tier: handle.tier,
      reason,
    });
    return {
      data: { sandboxId, state: "terminated", reason },
      summary: `Terminated sandbox ${sandboxId}`,
    };
  } catch (err) {
    return {
      exitCode: 1,
      summary: `Terminate failed: ${(err as Error).message}`,
    };
  }
}

export async function runCapabilityBridge(
  input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const sandboxId = flagString(input, "sandbox-id");
  const mgr = getManager();
  const handle = mgr.inspect(sandboxId);
  if (!handle) {
    return {
      exitCode: 1,
      summary: `Sandbox ${sandboxId} not found`,
    };
  }
  return {
    data: { sandboxId, bridgeId: `bridge-${sandboxId}` },
    summary: `Capability bridge created for ${sandboxId}`,
  };
}
