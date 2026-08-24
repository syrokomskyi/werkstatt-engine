/*
<MODULE_CONTRACT>
<purpose>RFC-0355 §5.6: bordbuch.append — append a single entry through the controlled writer-role surface.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial bordbuch.append command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import type { BordbuchEntryKind } from "@warpgogol/werkstatt-engine/schemas";
import { appendBordbuchEntry, validateWriterRole, readBordbuch } from "./bordbuch-io.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";

export interface BordbuchAppendData {
  eventId: string;
  systemId: string;
  kind: BordbuchEntryKind;
  hash: string;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runBordbuchAppend(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<BordbuchAppendData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const kind = flagString(input, "kind") as BordbuchEntryKind | undefined;
  const summary = flagString(input, "summary");
  const missionId = flagString(input, "mission") ?? null;
  const releaseId = flagString(input, "release") ?? null;
  const actor = flagString(input, "actor") ?? "agent";
  const writerRole = flagString(input, "writer-role");
  const metadataStr = flagString(input, "metadata");

  if (!systemId) throw new Error("[bordbuch.append] --system is required");
  if (!kind) throw new Error("[bordbuch.append] --kind is required");
  if (!summary) throw new Error("[bordbuch.append] --summary is required");
  if (!writerRole) throw new Error("[bordbuch.append] --writer-role is required");

  if (!validateWriterRole(writerRole, kind)) {
    throw new Error(
      `[bordbuch.append] kind '${kind}' is not allowed for writer-role '${writerRole}'`,
    );
  }

  // Check mission-lifecycle kinds require open mission
  if (kind === "mission-open" || kind === "mission-close" || kind === "mission-abort") {
    if (!missionId) {
      throw new Error(`[bordbuch.append] --mission is required for kind '${kind}'`);
    }
  }

  let metadata: Record<string, unknown> | undefined;
  if (metadataStr) {
    try {
      metadata = JSON.parse(metadataStr);
    } catch {
      throw new Error("[bordbuch.append] --metadata must be valid JSON");
    }
  }

  const operationId = generateOperationId();
  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "bordbuch.append", actor);
  await acquireLock(workspaceRoot, `bordbuch:${systemId}`, operationId, "bordbuch.append", actor);

  try {
    // Check terminal mission for mission-lifecycle kinds
    if (missionId && (kind === "mission-close" || kind === "mission-abort")) {
      const entries = await readBordbuch(workspaceRoot, systemId);
      const missionEntries = entries.filter((e) => e.missionId === missionId);
      const hasOpen = missionEntries.some((e) => e.kind === "mission-open");
      const hasTerminal = missionEntries.some(
        (e) => e.kind === "mission-close" || e.kind === "mission-abort",
      );
      if (!hasOpen) {
        throw new Error(`[bordbuch.append] mission '${missionId}' has no preceding mission-open`);
      }
      if (hasTerminal) {
        throw new Error(`[bordbuch.append] mission '${missionId}' is already in a terminal state`);
      }
    }

    const entry = await appendBordbuchEntry(workspaceRoot, systemId, kind, summary, actor, {
      missionId,
      releaseId,
      writerRole,
      metadata,
    });

    logger.success(`[bordbuch.append] appended ${entry.id} to ${systemId} Bordbuch`);

    return {
      data: {
        eventId: entry.id,
        systemId,
        kind,
        hash: entry.hash,
      },
      summary: `[bordbuch.append] appended ${entry.id} to ${systemId} Bordbuch`,
      nextSteps: [
        {
          action: `Commit the bordbuch: pnpm exec werkstatt run bordbuch.commit --site ${systemId}`,
          kind: "optional",
        },
      ],
    };
  } finally {
    await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }
}
