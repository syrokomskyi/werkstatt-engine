/*
<MODULE_CONTRACT>
<purpose>RFC-1035: CapabilityBridge implementation — client-side proxy that delegates to
CapabilityBrokerV1 with sandbox-specific policy enforcement (timeout, memory, violation tracking).</purpose>
<non-goals>
  <item>Does not implement the broker itself — that lives in broker/broker.ts.</item>
  <item>Does not implement sandbox spawning — that lives in isolation-manager.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-1035: initial implementation of CapabilityBridge extending CapabilityBrokerV1.</item>
</CHANGE_SUMMARY>
*/

import type { CapabilityId } from "../component/contracts.ts";
import type {
  CapabilityBridgeRequestV1,
  CapabilityBridgeResponseV1,
  CapabilityBridge as ICapabilityBridge,
  IsolationPolicy,
  TerminationReportV1,
} from "./contracts.ts";
import type { CapabilityBrokerV1, BrokerInvocationContextV1 } from "./broker/broker.ts";

const VIOLATION_WINDOW_MS = 60_000;
const VIOLATION_THRESHOLD = 3;

export interface CapabilityBridgeOptions {
  readonly sandboxId: string;
  readonly broker: CapabilityBrokerV1;
  readonly policy: IsolationPolicy;
  readonly brokerContext: BrokerInvocationContextV1;
  readonly onViolation?: (sandboxId: string, reason: string) => void;
  readonly onTerminate?: (sandboxId: string, reason: string) => void;
}

interface ViolationRecord {
  readonly timestamp: number;
  readonly reason: string;
}

export function createCapabilityBridge(opts: CapabilityBridgeOptions): ICapabilityBridge {
  const violations: ViolationRecord[] = [];
  let terminated = false;

  function pruneViolations(now: number): void {
    const cutoff = now - VIOLATION_WINDOW_MS;
    while (violations.length > 0 && violations[0]!.timestamp < cutoff) {
      violations.shift();
    }
  }

  function recordViolation(reason: string): void {
    const now = Date.now();
    pruneViolations(now);
    violations.push({ timestamp: now, reason });
    opts.onViolation?.(opts.sandboxId, reason);
    if (violations.length >= VIOLATION_THRESHOLD) {
      terminated = true;
      opts.onTerminate?.(opts.sandboxId, `violation threshold exceeded: ${reason}`);
    }
  }

  function checkPolicy(command: CapabilityId): CapabilityBridgeResponseV1 | null {
    if (terminated) {
      return {
        schema: "werkstatt/capability-bridge-response@1",
        requestId: "bridge-terminated",
        status: "error",
        payload: new Uint8Array(0),
        diagnostics: ["bridge is terminated due to violation threshold"],
      };
    }

    const granted = opts.policy.grantedCommands.some(
      (c) => String(c) === String(command),
    );
    if (!granted) {
      const response: CapabilityBridgeResponseV1 = {
        schema: "werkstatt/capability-bridge-response@1",
        requestId: "policy-check",
        status: "denied",
        payload: new Uint8Array(0),
        diagnostics: [`ISOLATION-01: command "${String(command)}" not in grantedCommands`],
      };
      recordViolation(`command not granted: ${String(command)}`);
      return response;
    }

    return null;
  }

  return {
    async call(command: CapabilityId, input: Uint8Array): Promise<CapabilityBridgeResponseV1> {
      const policyViolation = checkPolicy(command);
      if (policyViolation) {
        return policyViolation;
      }

      const requestId = `bridge-${opts.sandboxId}-${Date.now()}`;
      const deadline = Date.now() + opts.policy.timeoutMs;

      const request: CapabilityBridgeRequestV1 = {
        schema: "werkstatt/capability-bridge-request@1",
        requestId,
        capability: command,
        grant: {
          scope: "read",
          resource: "sandbox",
          maxDuration: opts.policy.timeoutMs,
          maxOperations: 100,
        },
        payload: input,
        deadline,
      };

      const timeoutPromise = new Promise<CapabilityBridgeResponseV1>((resolve) => {
        setTimeout(() => {
          resolve({
            schema: "werkstatt/capability-bridge-response@1",
            requestId,
            status: "timeout",
            payload: new Uint8Array(0),
            diagnostics: [`ISOLATION-02: timeout exceeded ${opts.policy.timeoutMs}ms`],
          });
        }, opts.policy.timeoutMs);
      });

      const brokerPromise = opts.broker.invoke(request, opts.brokerContext);

      const response = await Promise.race([brokerPromise, timeoutPromise]);

      if (response.status === "timeout") {
        recordViolation(`timeout: ${String(command)}`);
      }

      return response;
    },

    async ping(): Promise<boolean> {
      return !terminated;
    },

    async terminate(reason: string): Promise<TerminationReportV1> {
      terminated = true;
      return {
        schema: "werkstatt/termination-report@1",
        workloadId: opts.sandboxId,
        reason,
        terminated: true,
        quarantined: violations.length >= VIOLATION_THRESHOLD,
        diagnostics: [],
      };
    },
  };
}
