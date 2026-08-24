/*
<MODULE_CONTRACT>
<purpose>RFC-0290: tests for the closed-schema-subset interpreter + IntegrationEvent builder.</purpose>
<keywords>RFC-0290, agent surface, gate, actions, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="tests">required/unknown-property/type/format/length validation, event building.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial action interpreter tests.</item>
  <item>Post-refactor hardening: cover prototype-key unknown property validation.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { validateAgainstCapabilitySchema, buildIntegrationEventFromAction } from "../actions.ts";
import type { CapabilityRecord, CapabilityInputOutputSchema } from "@warpgogol/werkstatt-shared/ontology";

const schema: CapabilityInputOutputSchema = {
  type: "object",
  required: ["message"],
  additionalProperties: false,
  properties: {
    message: { type: "string", minLength: 10, maxLength: 4000 },
    email: { type: "string", format: "email" },
    eventId: { type: "string", format: "uuid" },
    accepted: { type: "boolean" },
    count: { type: "integer" },
  },
};

test("validateAgainstCapabilitySchema: rejects non-object input", () => {
  const result = validateAgainstCapabilitySchema(schema, "nope");
  expect(result.ok).toBe(false);
});

test("validateAgainstCapabilitySchema: rejects unknown properties", () => {
  const result = validateAgainstCapabilitySchema(schema, { message: "hello there", extra: 1 });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.some((e) => e.path === "extra")).toBeTruthy();
});

test("validateAgainstCapabilitySchema: treats prototype property names as unknown input keys", () => {
  const result = validateAgainstCapabilitySchema(schema, {
    message: "hello there",
    toString: "not schema-owned",
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.some((e) => e.path === "toString")).toBeTruthy();
});

test("validateAgainstCapabilitySchema: reports missing required fields", () => {
  const result = validateAgainstCapabilitySchema(schema, {});
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors).toEqual([{ path: "message", message: "required" }]);
});

test("validateAgainstCapabilitySchema: enforces minLength/maxLength", () => {
  const tooShort = validateAgainstCapabilitySchema(schema, { message: "short" });
  expect(tooShort.ok).toBe(false);
  const ok = validateAgainstCapabilitySchema(schema, { message: "a".repeat(20) });
  expect(ok.ok).toBe(true);
});

test("validateAgainstCapabilitySchema: enforces email format", () => {
  const bad = validateAgainstCapabilitySchema(schema, {
    message: "hello there!!",
    email: "not-an-email",
  });
  expect(bad.ok).toBe(false);
  const good = validateAgainstCapabilitySchema(schema, {
    message: "hello there!!",
    email: "a@b.com",
  });
  expect(good.ok).toBe(true);
});

test("validateAgainstCapabilitySchema: enforces type checks (boolean, integer)", () => {
  const badBool = validateAgainstCapabilitySchema(schema, {
    message: "hello there!!",
    accepted: "yes",
  });
  expect(badBool.ok).toBe(false);
  const badInt = validateAgainstCapabilitySchema(schema, { message: "hello there!!", count: 1.5 });
  expect(badInt.ok).toBe(false);
  const good = validateAgainstCapabilitySchema(schema, {
    message: "hello there!!",
    accepted: true,
    count: 3,
  });
  expect(good.ok).toBe(true);
});

function makeCapability(): CapabilityRecord {
  return {
    id: "lead.submit",
    version: 1,
    kind: "action",
    title: { de: "x" },
    description: { de: "x" },
    input: schema,
    output: schema,
    integration: { eventKind: "lead", source: "agent" },
    requires: { entitlements: [], sections: ["send-message"] },
    humanEquivalent: { sectionType: "send-message" },
    limits: { perMinutePerIp: 10, maxPayloadBytes: 16384 },
  };
}

test("buildIntegrationEventFromAction: extracts contact fields and keeps full payload", () => {
  const cap = makeCapability();
  const now = new Date("2026-07-05T00:00:00.000Z");
  const event = buildIntegrationEventFromAction(
    cap,
    { message: "hello there!!", email: "a@b.com" },
    "de",
    now,
  );
  expect(event.kind).toBe("lead");
  expect(event.source).toBe("agent");
  expect(event.locale).toBe("de");
  expect(event.occurredAt).toBe("2026-07-05T00:00:00.000Z");
  expect(event.contact).toEqual({ email: "a@b.com" });
  expect(event.payload).toEqual({ message: "hello there!!", email: "a@b.com" });
  expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/);
});

test("buildIntegrationEventFromAction: reuses a client-supplied valid uuid eventId", () => {
  const cap = makeCapability();
  const clientId = "11111111-1111-1111-1111-111111111111";
  const event = buildIntegrationEventFromAction(
    cap,
    { message: "hello there!!", eventId: clientId },
    "de",
    new Date(),
  );
  expect(event.eventId).toBe(clientId);
});
