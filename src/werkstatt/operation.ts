/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/werkstatt/operation.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not store raw command arguments — hashes only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0362: initial operation record helpers (start, complete, fail, read).</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  werkstattOperationRecordSchema,
  type WerkstattOperationRecord,
} from "@warpgogol/werkstatt-engine/schemas";

const OPERATIONS_DIR = path.join(".werkstatt", "operations");

function resolveOperationsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, OPERATIONS_DIR);
}

function resolveOperationPath(workspaceRoot: string, operationId: string): string {
  const safeId = operationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(resolveOperationsDir(workspaceRoot), `${safeId}.json`);
}

function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/token|password|secret|credential/i.test(key)) {
      sanitized[key] = "[redacted]";
    } else if (typeof value === "string" && /:\/\/[^@]+@/.test(value)) {
      sanitized[key] = "[redacted]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function computeInputHash(input: Record<string, unknown>): string {
  const sanitized = sanitizeInput(input);
  const json = JSON.stringify(sanitized, Object.keys(sanitized).sort());
  return `sha256:${createHash("sha256").update(json).digest("hex")}`;
}

export function generateOperationId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `op-${ts}-${rand}`;
}

export async function startOperation(
  workspaceRoot: string,
  operationId: string,
  command: string,
  scopes: string[],
  inputHash: string,
): Promise<WerkstattOperationRecord> {
  const opsDir = resolveOperationsDir(workspaceRoot);
  if (!existsSync(opsDir)) {
    await fs.mkdir(opsDir, { recursive: true });
  }

  const record: WerkstattOperationRecord = {
    schemaVersion: "1.0.0",
    operationId,
    command,
    scopes,
    state: "started",
    startedAt: new Date().toISOString(),
    completedAt: null,
    inputHash,
    resultHash: null,
    artifacts: [],
    error: null,
  };

  werkstattOperationRecordSchema.parse(record);
  await fs.writeFile(
    resolveOperationPath(workspaceRoot, operationId),
    JSON.stringify(record, null, 2) + "\n",
    "utf8",
  );
  return record;
}

export async function completeOperation(
  workspaceRoot: string,
  operationId: string,
  resultHash: string | null,
  artifacts: string[],
): Promise<WerkstattOperationRecord> {
  const opPath = resolveOperationPath(workspaceRoot, operationId);
  const raw = await fs.readFile(opPath, "utf8");
  const record = werkstattOperationRecordSchema.parse(JSON.parse(raw));

  record.state = "completed";
  record.completedAt = new Date().toISOString();
  record.resultHash = resultHash;
  record.artifacts = artifacts;

  werkstattOperationRecordSchema.parse(record);
  await fs.writeFile(opPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

export async function failOperation(
  workspaceRoot: string,
  operationId: string,
  error: string,
): Promise<WerkstattOperationRecord> {
  const opPath = resolveOperationPath(workspaceRoot, operationId);
  const raw = await fs.readFile(opPath, "utf8");
  const record = werkstattOperationRecordSchema.parse(JSON.parse(raw));

  record.state = "failed";
  record.completedAt = new Date().toISOString();
  record.error = error;

  werkstattOperationRecordSchema.parse(record);
  await fs.writeFile(opPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

export async function readOperation(
  workspaceRoot: string,
  operationId: string,
): Promise<WerkstattOperationRecord | null> {
  const opPath = resolveOperationPath(workspaceRoot, operationId);
  if (!existsSync(opPath)) return null;
  const raw = await fs.readFile(opPath, "utf8");
  try {
    return werkstattOperationRecordSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
