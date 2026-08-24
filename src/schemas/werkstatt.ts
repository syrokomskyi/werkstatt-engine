/*
<MODULE_CONTRACT>
<purpose>
RFC-0362: Zod schemas for Werkstatt consistency primitives — lock files and
operation records. These schemas are the machine-checkable contract for all
Werkstatt lock and idempotency operations.
</purpose>
<non-goals>
  <item>Do not perform file IO — pure shape only.</item>
  <item>Do not define hash-chain Bordbuch format — that is RFC-0276/RFC-0355.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0362: initial Werkstatt schemas (WerkstattLock, WerkstattOperationRecord).</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";

export const werkstattLockSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  scope: z.string().min(1),
  operationId: z.string().min(1),
  command: z.string().min(1),
  owner: z.string().min(1),
  pid: z.number().int(),
  startedAt: z.string().datetime(),
  heartbeatAt: z.string().datetime(),
  timeoutSeconds: z.number().positive(),
  depth: z.number().int().positive().optional(),
});

export const werkstattOperationRecordSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  operationId: z.string().min(1),
  command: z.string().min(1),
  scopes: z.array(z.string().min(1)),
  state: z.enum(["started", "completed", "failed"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  inputHash: z.string().min(1),
  resultHash: z.string().nullable(),
  artifacts: z.array(z.string()),
  error: z.string().nullable(),
});

export type WerkstattLock = z.infer<typeof werkstattLockSchema>;
export type WerkstattOperationRecord = z.infer<typeof werkstattOperationRecordSchema>;
