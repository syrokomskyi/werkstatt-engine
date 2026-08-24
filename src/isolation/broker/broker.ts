import type { CapabilityId } from "../../component/contracts.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";
import type {
  AttenuatedGrantSetV1,
  CapabilityBridgeRequestV1,
  CapabilityBridgeResponseV1,
} from "../contracts.ts";

export interface BrokerPolicyV1 {
  schema: "werkstatt/broker-policy@1";
  policyId: string;
  version: string;
  allowedCapabilities: readonly CapabilityId[];
  maxRequestBytes: number;
  maxResponseBytes: number;
  defaultTimeoutMs: number;
  maxConcurrentRequests: number;
}

export interface BrokerAuditEntryV1 {
  schema: "werkstatt/broker-audit-entry@1";
  requestId: string;
  callerId: string;
  workloadId: string;
  artifactHash: Sha256Digest;
  grantSetHash: Sha256Digest;
  capability: CapabilityId;
  status: "ok" | "denied" | "error" | "timeout";
  timestamp: string;
  redactedDiagnostics: readonly string[];
}

export type BrokerHandlerV1 = (
  request: CapabilityBridgeRequestV1,
) => Promise<CapabilityBridgeResponseV1>;

export interface RegisteredCapabilityV1 {
  capability: CapabilityId;
  handler: BrokerHandlerV1;
}

export interface CapabilityBrokerV1 {
  registerCapability(capability: CapabilityId, handler: BrokerHandlerV1): BrokerRegisterOutcomeV1;
  invoke(
    request: CapabilityBridgeRequestV1,
    context: BrokerInvocationContextV1,
  ): Promise<CapabilityBridgeResponseV1>;
  auditLog(): readonly BrokerAuditEntryV1[];
  registeredCapabilities(): readonly CapabilityId[];
}

export interface BrokerInvocationContextV1 {
  callerId: string;
  workloadId: string;
  artifactHash: Sha256Digest;
  grantSet: AttenuatedGrantSetV1;
  policy: BrokerPolicyV1;
  timestamp: string;
}

export interface BrokerRegisterResultV1 {
  ok: true;
  capability: CapabilityId;
}

export interface BrokerRegisterFailureV1 {
  ok: false;
  ruleId: "CERT-BROKER-01" | "CERT-BROKER-02";
  message: string;
}

export type BrokerRegisterOutcomeV1 = BrokerRegisterResultV1 | BrokerRegisterFailureV1;

const DENIED_CAPABILITIES = new Set<string>([
  "fs",
  "net",
  "process",
  "env",
  "credential",
  "descriptor",
  "ipc",
  "host-object",
]);

export function createCapabilityBroker(): CapabilityBrokerV1 {
  const capabilities = new Map<string, RegisteredCapabilityV1>();
  const audit: BrokerAuditEntryV1[] = [];
  let activeRequests = 0;

  return {
    registerCapability(
      capability: CapabilityId,
      handler: BrokerHandlerV1,
    ): BrokerRegisterOutcomeV1 {
      const capStr = String(capability);
      if (DENIED_CAPABILITIES.has(capStr)) {
        return {
          ok: false,
          ruleId: "CERT-BROKER-01",
          message: `capability "${capStr}" is ambient host access — denied by construction`,
        };
      }

      if (capabilities.has(capStr)) {
        return {
          ok: false,
          ruleId: "CERT-BROKER-02",
          message: `capability "${capStr}" is already registered`,
        };
      }

      capabilities.set(capStr, { capability, handler });
      return { ok: true, capability };
    },

    async invoke(
      request: CapabilityBridgeRequestV1,
      context: BrokerInvocationContextV1,
    ): Promise<CapabilityBridgeResponseV1> {
      const capStr = String(request.capability);

      const deniedResponse = (
        reason: string,
        status: "denied" | "timeout" | "error" = "denied",
      ): CapabilityBridgeResponseV1 => {
        const entry: BrokerAuditEntryV1 = {
          schema: "werkstatt/broker-audit-entry@1",
          requestId: request.requestId,
          callerId: context.callerId,
          workloadId: context.workloadId,
          artifactHash: context.artifactHash,
          grantSetHash: context.grantSet.grantSetHash,
          capability: request.capability,
          status,
          timestamp: context.timestamp,
          redactedDiagnostics: [reason],
        };
        audit.push(entry);
        return {
          schema: "werkstatt/capability-bridge-response@1",
          requestId: request.requestId,
          status,
          payload: new Uint8Array(0),
          diagnostics: [reason],
        };
      };

      if (!context.policy.allowedCapabilities.includes(request.capability)) {
        return deniedResponse(`capability "${capStr}" is not in policy allowed list`);
      }

      const registered = capabilities.get(capStr);
      if (!registered) {
        return deniedResponse(`capability "${capStr}" is not registered`);
      }

      const grantExists = context.grantSet.grants.some(
        (g) => g.scope === request.grant.scope && g.resource === request.grant.resource,
      );
      if (!grantExists) {
        return deniedResponse(
          `grant scope "${request.grant.scope}" resource "${request.grant.resource}" is not in grant set`,
        );
      }

      if (request.payload.length > context.policy.maxRequestBytes) {
        return deniedResponse(
          `request payload ${request.payload.length} exceeds max ${context.policy.maxRequestBytes}`,
        );
      }

      if (activeRequests >= context.policy.maxConcurrentRequests) {
        return deniedResponse(
          `concurrent requests ${activeRequests} exceed max ${context.policy.maxConcurrentRequests}`,
        );
      }

      activeRequests++;
      try {
        const response = await registered.handler(request);

        if (response.payload.length > context.policy.maxResponseBytes) {
          return deniedResponse(
            `response payload ${response.payload.length} exceeds max ${context.policy.maxResponseBytes}`,
            "error",
          );
        }

        const entry: BrokerAuditEntryV1 = {
          schema: "werkstatt/broker-audit-entry@1",
          requestId: request.requestId,
          callerId: context.callerId,
          workloadId: context.workloadId,
          artifactHash: context.artifactHash,
          grantSetHash: context.grantSet.grantSetHash,
          capability: request.capability,
          status: response.status,
          timestamp: context.timestamp,
          redactedDiagnostics: response.diagnostics,
        };
        audit.push(entry);

        return response;
      } catch (err) {
        return deniedResponse(
          `handler error: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      } finally {
        activeRequests--;
      }
    },

    auditLog(): readonly BrokerAuditEntryV1[] {
      return [...audit];
    },

    registeredCapabilities(): readonly CapabilityId[] {
      return [...capabilities.values()].map((c) => c.capability);
    },
  };
}
