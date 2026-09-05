/*
<MODULE_CONTRACT>
<purpose>RFC-1035: IsolationManager implementation — manages sandbox lifecycle
(spawn, inspect, terminate, list) and component tier assignments.</purpose>
<non-goals>
  <item>Does not implement sandbox providers — those are admitted IsolationAdapterV1 instances.</item>
  <item>Does not implement bordbuch I/O — lifecycle events are emitted via callback.</item>
  <item>Does not implement kernel command handlers — those live in isolation.module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-1035: initial implementation of IsolationManager.</item>
</CHANGE_SUMMARY>
*/

import type { ComponentId, IsolationTier } from "../component/contracts.ts";
import type {
  IsolationAdapterV1,
  IsolationManager as IIsolationManager,
  IsolationPolicy,
  SandboxHandle,
  SandboxState,
  SandboxedWorkloadCreateV1,
  TerminationReportV1,
} from "./contracts.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";

const DEFAULT_MAX_SANDBOXES = 16;

const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /\.env/i,
  /system-state\.yaml$/i,
  /\.pem$/i,
  /\.key$/i,
  /credentials/i,
  /secret/i,
];

export interface IsolationManagerOptions {
  readonly maxSandboxes?: number;
  readonly onSandboxEvent?: (event: SandboxLifecycleEvent) => void;
}

export interface SandboxLifecycleEvent {
  readonly type: "spawn" | "terminate" | "crash";
  readonly sandboxId: string;
  readonly componentId: ComponentId;
  readonly tier: IsolationTier;
  readonly reason?: string;
  readonly crashReason?: string;
}

export interface AdmittedProvider {
  readonly adapter: IsolationAdapterV1;
  readonly tier: IsolationTier;
}

function generateSandboxId(componentId: ComponentId): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sandbox-${ts}-${rand}`;
}

function validatePolicyPaths(policy: IsolationPolicy): string | null {
  for (const path of policy.fsReadPaths) {
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(path)) {
        return `fsReadPath "${path}" matches sensitive pattern`;
      }
    }
  }
  for (const path of policy.fsWritePaths) {
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(path)) {
        return `fsWritePath "${path}" matches sensitive pattern`;
      }
    }
  }
  return null;
}

export function createIsolationManager(
  providers: ReadonlyArray<AdmittedProvider>,
  options: IsolationManagerOptions = {},
): IIsolationManager {
  const maxSandboxes = options.maxSandboxes ?? DEFAULT_MAX_SANDBOXES;
  const sandboxes = new Map<string, SandboxHandle>();
  const tierAssignments = new Map<string, IsolationTier>();
  const onEvent = options.onSandboxEvent;

  function findProvider(tier: IsolationTier): AdmittedProvider | null {
    return providers.find((p) => p.tier === tier) ?? null;
  }

  return {
    async spawn(
      componentId: ComponentId,
      tier: IsolationTier,
      policy: IsolationPolicy,
    ): Promise<SandboxHandle> {
      if (tier === 0) {
        throw new Error("ISOLATION-06: Tier 0 requires human approval for spawn");
      }

      const provider = findProvider(tier);
      if (!provider) {
        throw new Error(`ISOLATION-07: no admitted provider for tier ${tier}`);
      }

      const sensitiveViolation = validatePolicyPaths(policy);
      if (sensitiveViolation) {
        throw new Error(`ISOLATION-08: ${sensitiveViolation}`);
      }

      if (sandboxes.size >= maxSandboxes) {
        throw new Error(`ISOLATION-04: spawn failed — max sandbox count ${maxSandboxes} reached`);
      }

      const sandboxId = generateSandboxId(componentId);
      const artifactHash = "sha256:" + "0".repeat(64) as Sha256Digest;

      const createInput: SandboxedWorkloadCreateV1 = {
        workloadId: sandboxId,
        artifactHash,
        grantSet: {
          schema: "werkstatt/attenuated-grant-set@1",
          grants: [],
          grantSetHash: artifactHash,
        },
        limits: {
          maxMemoryBytes: policy.memoryLimitBytes,
          maxCpuTimeMs: policy.cpuLimitPercent * 1000,
          maxWallTimeMs: policy.timeoutMs,
          maxConcurrency: 1,
          maxResponseBytes: 65536,
          maxRequestBytes: 65536,
        },
        bridgeSchemaHash: artifactHash,
        idempotencyKey: sandboxId,
      };

      const workload = await provider.adapter.create(createInput);

      const handle: SandboxHandle = {
        ...workload,
        sandboxId,
        componentId,
        tier,
        policy,
        state: "active" as SandboxState,
        memoryUsageBytes: 0,
        cpuUsagePercent: 0,
        crashReason: null,
        health: "healthy" as const,
      };

      sandboxes.set(sandboxId, handle);
      onEvent?.({
        type: "spawn",
        sandboxId,
        componentId,
        tier,
      });

      return handle;
    },

    inspect(sandboxId: string): SandboxHandle | null {
      return sandboxes.get(sandboxId) ?? null;
    },

    async terminate(sandboxId: string, reason: string): Promise<TerminationReportV1> {
      const handle = sandboxes.get(sandboxId);
      if (!handle) {
        throw new Error(`ISOLATION-09: sandbox ${sandboxId} not found`);
      }

      const report = await handle.terminate(reason);

      const updated: SandboxHandle = {
        ...handle,
        state: "terminated" as SandboxState,
        crashReason: null,
        health: "unhealthy" as const,
      };
      sandboxes.set(sandboxId, updated);
      sandboxes.delete(sandboxId);

      onEvent?.({
        type: "terminate",
        sandboxId,
        componentId: handle.componentId,
        tier: handle.tier,
        reason,
      });

      return report;
    },

    list(): readonly SandboxHandle[] {
      return [...sandboxes.values()];
    },

    assignTier(componentId: ComponentId, tier: IsolationTier): void {
      if (tier === 0) {
        throw new Error("ISOLATION-06: Tier 0 requires human approval");
      }
      tierAssignments.set(String(componentId), tier);
    },

    getTier(componentId: ComponentId): IsolationTier {
      return tierAssignments.get(String(componentId)) ?? 0;
    },
  };
}
