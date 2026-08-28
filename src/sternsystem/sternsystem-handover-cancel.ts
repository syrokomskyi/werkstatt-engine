/*
<MODULE_CONTRACT>
<purpose>RFC-0968: sternsystem.handover.cancel — the sending instance cancels a pending
handover by removing the authorization file and clearing the HANDOVER-01 block.</purpose>
<non-goals>
  <item>Does not verify any signatures — cancel is a local cleanup operation.</item>
  <item>Does not propagate the removal to mirrors — use sternsystem.sync after cancel.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0968: initial handover cancel command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { resolveActor } from "../mission/actor-identity.ts";
import { removeAuthorization } from "./handover.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";

export interface SternsystemHandoverCancelData {
  command: "sternsystem.handover.cancel";
  systemId: string;
  cancelled: boolean;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runSternsystemHandoverCancel(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemHandoverCancelData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "id");

  if (!systemId) {
    throw new Error("[sternsystem.handover.cancel] requires --id <systemId>");
  }

  const actor = resolveActor(input);

  const operationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    operationId,
    "sternsystem.handover.cancel",
    actor,
  );

  try {
    const cancelled = await removeAuthorization(workspaceRoot, systemId);

    if (cancelled) {
      logger.success(
        `[sternsystem.handover.cancel] ${systemId} pending handover cancelled — authorization file removed`,
      );
    } else {
      logger.info(
        `[sternsystem.handover.cancel] ${systemId} no pending handover found — nothing to cancel`,
      );
    }

    return {
      data: {
        command: "sternsystem.handover.cancel",
        systemId,
        cancelled,
      },
      summary: cancelled
        ? `[sternsystem.handover.cancel] ${systemId} handover cancelled`
        : `[sternsystem.handover.cancel] ${systemId} no pending handover`,
    };
  } finally {
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }
}
