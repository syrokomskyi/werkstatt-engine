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
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type {
  CapabilityInputOutputSchema,
  CapabilityRecord,
} from "@warpgogol/werkstatt-shared/ontology";
import type { IntegrationEvent } from "@warpgogol/werkstatt-shared/integration/port";
import { deriveActionEventId } from "@warpgogol/werkstatt-shared/agent";

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

/**
 * Normalize validated action input into the delivery substrate's event shape.
 * RFC-1112: when `idempotencyKey` is present the eventId is derived
 * deterministically from it (same key → same eventId → QStash dedup and the
 * receipt store agree). Without a key the eventId is a random UUID.
 */
export function buildIntegrationEventFromAction(
  capability: CapabilityRecord,
  input: Record<string, unknown>,
  locale: string,
  now: Date,
  idempotencyKey?: string,
): IntegrationEvent {
  if (!capability.integration) {
    throw new Error(
      `capability "${capability.id}" has no integration block — only sideEffect "write" capabilities dispatch events`,
    );
  }
  const contact: Record<string, string> = {};
  for (const field of CONTACT_FIELDS) {
    const v = input[field];
    if (typeof v === "string" && v.length > 0) contact[field] = v;
  }
  const eventId = idempotencyKey
    ? deriveActionEventId(capability.id, idempotencyKey)
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
