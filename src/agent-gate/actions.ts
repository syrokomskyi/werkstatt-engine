/*
<MODULE_CONTRACT>
<purpose>
RFC-0290: the single validation path shared by both invocation surfaces (HTTP
POST and MCP tools/call). Interprets the RFC-0288 closed JSON-Schema subset
against an unknown request body, and builds the normalized IntegrationEvent
handed to the delivery substrate on success.
</purpose>
<non-goals>
  <item>Do not dispatch — the caller passes the built event to ports.dispatch.send.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial action interpreter.</item>
  <item>Post-refactor hardening: validate untrusted object keys with own-property checks.</item>
</CHANGE_SUMMARY>
*/

import type { CapabilityInputOutputSchema, CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import type { IntegrationEvent } from "@warpgogol/werkstatt-shared/integration/port";

export interface ValidationFieldError {
  path: string;
  message: string;
}

export type ValidationOutcome =
  { ok: true; value: Record<string, unknown> } | { ok: false; errors: ValidationFieldError[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validateFormat(value: string, format: string): boolean {
  switch (format) {
    case "email":
      return EMAIL_RE.test(value);
    case "uuid":
      return UUID_RE.test(value);
    case "date":
      return DATE_RE.test(value);
    case "uri":
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    default:
      return true;
  }
}

/**
 * Interpret the RFC-0288 closed JSON-Schema subset against `value`. Every
 * violation is reported (not fail-fast) so a caller can present the full set.
 */
export function validateAgainstCapabilitySchema(
  schema: CapabilityInputOutputSchema,
  value: unknown,
): ValidationOutcome {
  const errors: ValidationFieldError[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: [{ path: "", message: "must be a JSON object" }] };
  }
  const obj = value as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!hasOwn(schema.properties, key)) {
      errors.push({ path: key, message: `unknown property "${key}"` });
    }
  }
  for (const key of schema.required ?? []) {
    if (!hasOwn(obj, key) || obj[key] === undefined) {
      errors.push({ path: key, message: "required" });
    }
  }
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (!hasOwn(obj, key) || obj[key] === undefined) continue;
    const fieldValue = obj[key];
    const path = key;
    if (propSchema.type === "string") {
      if (typeof fieldValue !== "string") {
        errors.push({ path, message: "must be a string" });
        continue;
      }
      if (propSchema.minLength !== undefined && fieldValue.length < propSchema.minLength) {
        errors.push({ path, message: `must be at least ${propSchema.minLength} characters` });
      }
      if (propSchema.maxLength !== undefined && fieldValue.length > propSchema.maxLength) {
        errors.push({ path, message: `must be at most ${propSchema.maxLength} characters` });
      }
      if (propSchema.format && !validateFormat(fieldValue, propSchema.format)) {
        errors.push({ path, message: `must match format "${propSchema.format}"` });
      }
    } else if (propSchema.type === "boolean") {
      if (typeof fieldValue !== "boolean") errors.push({ path, message: "must be a boolean" });
    } else if (propSchema.type === "integer") {
      if (typeof fieldValue !== "number" || !Number.isInteger(fieldValue)) {
        errors.push({ path, message: "must be an integer" });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: obj };
}

const CONTACT_FIELDS = ["name", "email", "phone"] as const;

/** Normalize validated action input into the delivery substrate's event shape. */
export function buildIntegrationEventFromAction(
  capability: CapabilityRecord,
  input: Record<string, unknown>,
  locale: string,
  now: Date,
): IntegrationEvent {
  const contact: Record<string, string> = {};
  for (const field of CONTACT_FIELDS) {
    const v = input[field];
    if (typeof v === "string" && v.length > 0) contact[field] = v;
  }
  const eventId =
    typeof input.eventId === "string" && UUID_RE.test(input.eventId)
      ? input.eventId
      : crypto.randomUUID();

  return {
    eventId,
    kind: capability.integration.eventKind,
    source: capability.integration.source,
    locale,
    occurredAt: now.toISOString(),
    ...(Object.keys(contact).length > 0 ? { contact } : {}),
    payload: input,
  };
}
