/*
<MODULE_CONTRACT>
<purpose>RFC-1115: AC-4 tests for buildToolsList — agentGuidance rendered into tool descriptions, RFC-1112 fallback preserved when absent.</purpose>
<keywords>RFC-1115, MCP, tools/list, agentGuidance, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="tests">guidance composition, sideEffect-none fallback, no-guidance write fallback, knowledge tools.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-1115: replace load-verification shim with behavioral tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect } from "vitest";
import { buildToolsList } from "../tools.ts";
import { buildAgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";

const baseCapability: CapabilityRecord = {
  id: "lead.submit",
  version: 2,
  kind: "action",
  sideEffect: "write",
  title: { de: "Anfrage senden", en: "Submit a lead" },
  description: { de: "Reicht eine Kontaktanfrage ein.", en: "Submits a contact request." },
  input: { type: "object", properties: {}, additionalProperties: false },
  output: { type: "object", properties: {}, additionalProperties: false },
  integration: { eventKind: "lead", source: "agent" },
  requires: { entitlements: ["agent.actions"], sections: ["send-message"] },
  humanEquivalent: { sectionType: "send-message" },
  limits: { perMinutePerIp: 3, maxPayloadBytes: 10240 },
};

function manifestFor(ids: string[]) {
  return buildAgentSurfaceManifest({
    generatedAt: "2026-09-19T00:00:00Z",
    site: "s",
    baseUrl: "https://s.example",
    languages: { default: "en", supported: ["en"] },
    actions: ids.map((id) => ({
      id,
      url: `/api/agent/actions/${id}`,
      title: { en: id },
      inputSchemaRef: `${id}-input`,
      entitlement: "agent.actions" as const,
    })),
  });
}

describe("RFC-1115 AC-4: agentGuidance in tool descriptions", () => {
  it("composes base + whenToUse + whenNotToUse + sideEffect + retrySemantics", () => {
    const record: CapabilityRecord = {
      ...baseCapability,
      agentGuidance: {
        sideEffect: "write",
        whenToUse: "a visitor wants to contact the business.",
        whenNotToUse: "the answer is already on the site.",
        retrySemantics: "safe to retry with the same Idempotency-Key.",
      },
    };
    const tools = buildToolsList(manifestFor(["lead.submit"]), [record]);
    const tool = tools.find((t) => t.name === "action.lead.submit");
    expect(tool).toBeTruthy();
    expect(tool!.description).toContain("Submits a contact request.");
    expect(tool!.description).toContain("Use this when a visitor wants to contact the business.");
    expect(tool!.description).toContain("Do not use this when the answer is already on the site.");
    expect(tool!.description).toContain("side effects");
    expect(tool!.description).toContain(
      "Retry semantics: safe to retry with the same Idempotency-Key.",
    );
  });

  it("omits optional sentences when whenNotToUse/retrySemantics are absent", () => {
    const record: CapabilityRecord = {
      ...baseCapability,
      agentGuidance: { sideEffect: "write", whenToUse: "a lead should be created." },
    };
    const tools = buildToolsList(manifestFor(["lead.submit"]), [record]);
    const tool = tools.find((t) => t.name === "action.lead.submit");
    expect(tool!.description).toContain("Use this when a lead should be created.");
    expect(tool!.description).not.toContain("Do not use this when");
    expect(tool!.description).not.toContain("Retry semantics:");
  });

  it("falls back to base description when agentGuidance is absent (write)", () => {
    const tools = buildToolsList(manifestFor(["lead.submit"]), [baseCapability]);
    const tool = tools.find((t) => t.name === "action.lead.submit");
    expect(tool!.description).toBe("Submits a contact request.");
  });

  it("keeps the RFC-1112 preview suffix for sideEffect none without guidance", () => {
    const record: CapabilityRecord = {
      ...baseCapability,
      id: "lead.preview",
      sideEffect: "none",
      integration: undefined,
      humanEquivalent: undefined,
    };
    const tools = buildToolsList(manifestFor(["lead.preview"]), [record]);
    const tool = tools.find((t) => t.name === "action.lead.preview");
    expect(tool!.description).toContain("Side-effect-free preview");
  });

  it("emits one knowledge tool per knowledge ref", () => {
    const manifest = buildAgentSurfaceManifest({
      generatedAt: "2026-09-19T00:00:00Z",
      site: "s",
      baseUrl: "https://s.example",
      languages: { default: "en", supported: ["en"] },
      knowledge: [
        {
          domain: "offer",
          url: "/api/agent/v1/offer.json",
          schema: "gogol.agent.knowledge/offer@1",
        },
      ],
    });
    const tools = buildToolsList(manifest, []);
    expect(tools.map((t) => t.name)).toEqual(["knowledge.offer.get"]);
  });
});
