/*
<MODULE_CONTRACT>
<purpose>RFC-0355: Zod schemas for Mission lifecycle and Bordbuch (hash-chain logbook).</purpose>
<non-goals>
  <item>Does not define materialization — that is RFC-0356.</item>
  <item>Does not define release discipline — that is RFC-0357.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial Mission and Bordbuch schemas.</item>
  <item>RFC-0473: add pseo and indexnow.submit kinds for runtime operational events.</item>
  <item>RFC-0479: add mission-migrate kind for migration step bordbuch entries.</item>
  <item>RFC-0480: add rfcId to mission manifest for C-surface regression check traceability.</item>
  <item>RFC-0517: add preflight-skipped kind for preflight gate bypass audit trail.</item>
  <item>RFC-0706: add nachweis-record and nachweis-consent kinds for Nachweisregister trust lifecycle (ADR-0028).</item>
  <item>RFC-0715: add nachweis-signed and nachweis-timestamped kinds for N3 cryptographic verification.</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";

const missionIdRegex = /^[a-z0-9]+(-[a-z0-9]+)*-m\d{6}$/;
const systemIdRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const eventIdRegex = /^event-\d{6}$/;

export const missionStateSchema = z.enum(["open", "closed", "aborted"]);

export const missionManifestSchema = z.object({
  schemaVersion: z.string().min(1),
  missionId: z.string().regex(missionIdRegex),
  systemId: z.string().regex(systemIdRegex),
  state: missionStateSchema,
  brief: z.string().min(1),
  openedAt: z.string().datetime(),
  openedBy: z.string().min(1),
  closedAt: z.string().datetime().nullable(),
  closedBy: z.string().nullable(),
  pinAtOpen: z.string().min(1),
  materializedAt: z.string().datetime().nullable(),
  reconciledAt: z.string().datetime().nullable(),
  migratedAt: z.string().datetime().nullable(),
  releaseId: z.string().nullable(),
  rfcId: z.string().nullable().default(null),
  operationId: z.string().min(1),
});

// When renaming or removing a value from this enum, add the old value to
// DEPRECATED_KIND_MIGRATIONS in packages/os/site-kernel-handoff/src/bordbuch/bordbuch-io.ts
// so that existing bordbuch entries on disk are normalized during readBordbuch.
export const bordbuchEntryKindSchema = z.enum([
  "mission-open",
  "mission-close",
  "mission-abort",
  "release-ready",
  "release-rolled-back",
  "pin-update",
  "deployment",
  "notausgang-export",
  "operator-note",
  "erratum",
  "mirror-sync",
  "pseo",
  "indexnow.submit",
  "mission-migrate",
  "preflight-skipped",
  // RFC-0706 / ADR-0028: Nachweisregister trust lifecycle
  "nachweis-record",
  "nachweis-consent",
  // RFC-0715: N3 cryptographic verification (operator signature + RFC 3161 timestamp)
  "nachweis-signed",
  "nachweis-timestamped",
  // RFC-0888: Sichtpass lifecycle audit trail
  "sichtpass",
]);

export const bordbuchEntryStatusSchema = z.enum(["done", "failed", "waiting", "escalated"]);

export const bordbuchEntrySchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  id: z.string().regex(eventIdRegex),
  systemId: z.string().min(1),
  occurredAt: z.string().datetime(),
  kind: bordbuchEntryKindSchema,
  status: bordbuchEntryStatusSchema,
  missionId: z.string().nullable(),
  releaseId: z.string().nullable(),
  actor: z.string().min(1),
  summary: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  previousHash: z.string().nullable(),
  hash: z.string().min(1),
  erratumOf: z.string().optional(),
});

export type MissionState = z.infer<typeof missionStateSchema>;
export type MissionManifest = z.infer<typeof missionManifestSchema>;
export type BordbuchEntryKind = z.infer<typeof bordbuchEntryKindSchema>;
export type BordbuchEntryStatus = z.infer<typeof bordbuchEntryStatusSchema>;
export type BordbuchEntry = z.infer<typeof bordbuchEntrySchema>;
