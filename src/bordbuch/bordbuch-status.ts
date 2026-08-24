/*
<MODULE_CONTRACT>
<purpose>RFC-0473: bordbuch.status — read-only status projection from the unified Bordbuch ledger.</purpose>
<non-goals>
  <item>Does not write files — use bordbuch.generate for public projections.</item>
  <item>Does not validate the hash-chain — use bordbuch.validate for that.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0473: initial bordbuch.status command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";
import { readBordbuch } from "./bordbuch-io.ts";

export interface BordbuchStatusData {
  systemId: string;
  ledgerHash: string | null;
  eventCount: number;
  latestEvent: BordbuchEntry | null;
  openEscalations: BordbuchEntry[];
  latestDeploy: { eventId: string; occurredAt: string; status: string } | null;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runBordbuchStatus(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<BordbuchStatusData>> {
  const { workspaceRoot } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;

  if (!systemId) throw new Error("[bordbuch.status] --system is required");

  const entries = await readBordbuch(workspaceRoot, systemId);
  const latestEvent = entries.length > 0 ? entries[entries.length - 1] : null;
  const ledgerHash = latestEvent?.hash ?? null;
  const openEscalations = entries.filter((e) => e.status === "escalated" || e.status === "waiting");
  const latestDeployEntry = [...entries].reverse().find((e) => e.kind === "deployment");
  const latestDeploy = latestDeployEntry
    ? {
        eventId: latestDeployEntry.id,
        occurredAt: latestDeployEntry.occurredAt,
        status: latestDeployEntry.status,
      }
    : null;

  return {
    data: {
      systemId,
      ledgerHash,
      eventCount: entries.length,
      latestEvent,
      openEscalations,
      latestDeploy,
    },
    summary: `[bordbuch.status] ${systemId}: ${entries.length} entries, ${openEscalations.length} open escalation(s)`,
    nextSteps:
      openEscalations.length > 0
        ? [
            {
              action: `Resolve the ${openEscalations.length} open escalation(s) for ${systemId}`,
              kind: "optional",
            },
          ]
        : undefined,
  };
}
