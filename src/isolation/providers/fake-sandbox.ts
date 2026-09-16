/*
<MODULE_CONTRACT>
<purpose>fake-sandbox provider — fake sandbox adapter for isolation conformance tests.</purpose>
<non-goals>
  <item>Do not use in production — the fake adapter is test-only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { Sha256Digest } from "../../fingerprint/primitives.ts";
import { byteHash } from "../../fingerprint/primitives.ts";
import type {
  IsolationAdapterV1,
  IsolationPropertyEvidenceV1,
  SandboxedWorkloadCreateV1,
  SandboxedWorkloadV1,
  CapabilityBridgeRequestV1,
  CapabilityBridgeResponseV1,
  TerminationReportV1,
} from "../contracts.ts";
import { REQUIRED_PROPERTIES } from "../contracts.ts";

const FAKE_ADAPTER_ID = "fake-sandbox-v1";
const FAKE_ADAPTER_VERSION = "1.0.0";

const fakePropertyEvidence: IsolationPropertyEvidenceV1 = {
  schema: "werkstatt/isolation-property-evidence@1",
  properties: REQUIRED_PROPERTIES.map((kind) => ({
    kind,
    proven: true,
    evidenceHash: byteHash(`fake-evidence-${kind}`) as Sha256Digest,
    description: `fake sandbox proves ${kind}`,
  })),
  unsupported: [],
};

export function createFakeSandboxAdapter(): IsolationAdapterV1 {
  return {
    schema: "werkstatt/isolation-adapter@1",
    adapterId: FAKE_ADAPTER_ID,
    properties: fakePropertyEvidence,

    async create(input: SandboxedWorkloadCreateV1): Promise<SandboxedWorkloadV1> {
      let terminated = false;
      const invocations: CapabilityBridgeRequestV1[] = [];

      return {
        workloadId: input.workloadId,

        async invoke(
          request: CapabilityBridgeRequestV1,
        ): Promise<CapabilityBridgeResponseV1> {
          if (terminated) {
            return {
              schema: "werkstatt/capability-bridge-response@1",
              requestId: request.requestId,
              status: "error",
              payload: new Uint8Array(0),
              diagnostics: ["workload is terminated"],
            };
          }

          invocations.push(request);

          const responsePayload = new TextEncoder().encode(
            `fake-response:${request.requestId}`,
          );

          return {
            schema: "werkstatt/capability-bridge-response@1",
            requestId: request.requestId,
            status: "ok",
            payload: responsePayload,
            diagnostics: [],
          };
        },

        async terminate(reason: string): Promise<TerminationReportV1> {
          terminated = true;
          return {
            schema: "werkstatt/termination-report@1",
            workloadId: input.workloadId,
            reason,
            terminated: true,
            quarantined: false,
            diagnostics: [],
          };
        },
      };
    },
  };
}

export function getFakeAdapterId(): string {
  return FAKE_ADAPTER_ID;
}

export function getFakeAdapterVersion(): string {
  return FAKE_ADAPTER_VERSION;
}

export function getFakePropertyEvidence(): IsolationPropertyEvidenceV1 {
  return fakePropertyEvidence;
}
