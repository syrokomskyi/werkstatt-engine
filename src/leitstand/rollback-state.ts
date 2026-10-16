/*
<MODULE_CONTRACT>
<purpose>RFC-1297: record the outcome of a site rollback. After a channel
rollback succeeds, lastPropagated[&lt;channel&gt;] must name the release now live
(state "rolled-back", healthy null until re-verified) and the Bordbuch must
carry a deployment-rolled-back event — before this RFC, leitstand.rollback left
both untouched, letting live and recorded state diverge silently.</purpose>
<keywords>RFC-1297, leitstand.rollback, rolled-back, deployment-rolled-back, system-state, bordbuch</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1297: initial — recordSiteRollback writes lastPropagated + appends deployment-rolled-back; reconciles live releaseId via readLiveChannelStates when the rollback target is unknown.</item>
  <item>RFC-1297</item>
</CHANGE_SUMMARY>
*/

import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { readSystemStateSmart, writeSystemStateSmart } from "../sternsystem/registry-io.ts";
import { readLiveChannelStates, type LiveChannelName } from "../sternsystem/live-drift.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";

export interface RecordSiteRollbackResult {
  /** The release now believed live on the channel (null when undeterminable). */
  releaseId: string | null;
  /** True when system-state.yaml lastPropagated was updated. */
  stateWritten: boolean;
}

/**
 * RFC-1297 §4 steps 2–4: after `leitstand.rollback` succeeds on a site channel,
 * record reality — write lastPropagated[channel] with state "rolled-back" and
 * append a `deployment-rolled-back` Bordbuch event.
 *
 * The live releaseId is `rollbackTarget.releaseId` when the rollback resolved a
 * known Worker version; otherwise the channel's build-identity.json is probed
 * after the CDN purge. When neither yields a release, the state write is
 * skipped (lastPropagated.releaseId is a required string — recording a null
 * release would corrupt the record) and only the Bordbuch event remains.
 */
export async function recordSiteRollback(ctx: {
  workspaceRoot: string;
  systemId: string;
  channel: LiveChannelName;
  operationId: string;
  rollbackTarget: { versionId?: string; releaseId?: string };
  io: WorkspaceIO;
  fetchImpl?: typeof fetch;
}): Promise<RecordSiteRollbackResult> {
  const { workspaceRoot, systemId, channel, operationId, rollbackTarget, io } = ctx;

  let releaseId = rollbackTarget.releaseId ?? null;
  if (releaseId === null) {
    try {
      const states = await readLiveChannelStates({
        workspaceRoot,
        systemId,
        io,
        fetchImpl: ctx.fetchImpl,
      });
      releaseId = states.find((s) => s.channel === channel)?.liveReleaseId ?? null;
    } catch {
      // Non-fatal — live probe failed; releaseId stays null.
    }
  }

  let stateWritten = false;
  if (releaseId !== null) {
    try {
      const state = await readSystemStateSmart(workspaceRoot, systemId, io);
      state.lastPropagated[channel] = {
        releaseId,
        at: new Date().toISOString(),
        healthy: null,
        state: "rolled-back",
        operationId,
        leaseExpiresAt: null,
        ...(rollbackTarget.versionId ? { workerVersionId: rollbackTarget.versionId } : {}),
      };
      await writeSystemStateSmart(workspaceRoot, systemId, state, io);
      stateWritten = true;
    } catch {
      // Non-fatal — Bordbuch event still records the rollback below.
    }
  }

  try {
    await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "deployment-rolled-back",
      `${channel} rolled back to ${releaseId ?? "unknown"}`,
      "leitstand",
      { releaseId, metadata: { channel, operationId } },
    );
  } catch {
    // Non-fatal — the rollback itself already succeeded.
  }

  return { releaseId, stateWritten };
}
