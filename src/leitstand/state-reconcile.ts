/*
<MODULE_CONTRACT>
<purpose>RFC-1297: leitstand.state.reconcile — record the observed live release
of one channel into system-state.yaml (state "reconciled") and append a
live-state-reconciled Bordbuch event. It is the sanctioned, operator-driven
remedy for LIVE-01 drift: reality is recorded deliberately, with a reason —
never auto-legitimized.</purpose>
<keywords>RFC-1297, leitstand.state.reconcile, LIVE-01, live-state-reconciled, system-state</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1297: initial — --site/--channel/--from-live/--reason; probes build-identity.json live, writes lastPropagated state "reconciled", appends live-state-reconciled Bordbuch event.</item>
  <item>RFC-1297</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { generateOperationId } from "../werkstatt/index.ts";
import {
  readSystemConfigSmart,
  readSystemStateSmart,
  writeSystemStateSmart,
} from "../sternsystem/registry-io.ts";
import {
  buildAuthHeader,
  fetchChannelBuildIdentity,
  type LiveChannelName,
} from "../sternsystem/live-drift.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { flagSite } from "./deploy-helpers.ts";

const RECONCILE_CHANNELS: readonly LiveChannelName[] = ["dev", "alt", "main"];

export interface LeitstandStateReconcileData {
  command: "leitstand.state.reconcile";
  systemId: string;
  channel: LiveChannelName;
  recordedReleaseId: string | null;
  liveReleaseId: string | null;
  outcome: "reconciled" | "already-consistent";
  reason: string;
  operationId: string;
}

function reconcileResult(
  data: LeitstandStateReconcileData,
  summary: string,
  exitCode: 0 | 1,
): KernelCommandResult<LeitstandStateReconcileData> {
  return { data, summary, exitCode };
}

export async function runLeitstandStateReconcile(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<LeitstandStateReconcileData>> {
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[leitstand.state.reconcile] --site is required");

  const channelFlag = input.flags["channel"];
  if (typeof channelFlag !== "string" || !RECONCILE_CHANNELS.includes(channelFlag as never)) {
    throw new Error("[leitstand.state.reconcile] --channel dev|alt|main is required");
  }
  const channel = channelFlag as LiveChannelName;

  if (input.flags["from-live"] !== true) {
    throw new Error(
      "[leitstand.state.reconcile] --from-live is required — the only supported source is the live build-identity.json",
    );
  }

  const reasonFlag = input.flags["reason"];
  const reason = typeof reasonFlag === "string" ? reasonFlag.trim() : "";
  if (reason.length < 10) {
    throw new Error(
      "[leitstand.state.reconcile] --reason is required (>= 10 chars) — recording reality needs an accountable justification",
    );
  }

  const base: LeitstandStateReconcileData = {
    command: "leitstand.state.reconcile",
    systemId,
    channel,
    recordedReleaseId: null,
    liveReleaseId: null,
    outcome: "reconciled",
    reason,
    operationId: generateOperationId(),
  };

  const systemConfig = await readSystemConfigSmart(context.workspaceRoot, systemId, context.io);
  const channelUrl = systemConfig.deployment?.channels?.[channel]?.url;
  if (!channelUrl) {
    return reconcileResult(
      base,
      `[leitstand.state.reconcile] ${systemId}: channel '${channel}' has no configured URL`,
      1,
    );
  }

  const systemState = await readSystemStateSmart(context.workspaceRoot, systemId, context.io);
  const recordedReleaseId = systemState.lastPropagated?.[channel]?.releaseId ?? null;
  base.recordedReleaseId = recordedReleaseId;

  // RFC-1188: same outbound signing seam as leitstand.verify — channel probes
  // are platform-originated agent traffic.
  const { resolveOutboundAgentClient } = await import("./wba-signer.ts");
  const outbound = await resolveOutboundAgentClient(
    context.workspaceRoot,
    systemId,
    undefined,
    {
      onSigningFailure: (e) =>
        context.logger.warn(
          `[leitstand.state.reconcile] outbound signing failed, request sent unsigned: ${e instanceof Error ? e.message : String(e)}`,
        ),
    },
  );

  const result = await fetchChannelBuildIdentity(
    channel,
    channelUrl,
    buildAuthHeader(systemState.accessPin),
    10_000,
    outbound.client.fetch,
  );
  const liveReleaseId = result.buildIdentity?.releaseId ?? null;
  base.liveReleaseId = liveReleaseId;

  if (liveReleaseId === null) {
    // A missing identity is a deployment problem, not a records problem.
    return reconcileResult(
      base,
      `[leitstand.state.reconcile] ${systemId}: ${channel} live identity unreadable (${result.error ?? "no build-identity"}) — nothing truthful to record`,
      1,
    );
  }

  if (liveReleaseId === recordedReleaseId) {
    base.outcome = "already-consistent";
    return reconcileResult(
      base,
      `[leitstand.state.reconcile] ${systemId}: ${channel} already consistent — live and recorded both ${liveReleaseId}`,
      0,
    );
  }

  systemState.lastPropagated[channel] = {
    releaseId: liveReleaseId,
    at: new Date().toISOString(),
    healthy: null,
    state: "reconciled",
    operationId: base.operationId,
    leaseExpiresAt: null,
  };
  await writeSystemStateSmart(context.workspaceRoot, systemId, systemState, context.io);

  await appendAndCommitBordbuch(
    context.workspaceRoot,
    systemId,
    "live-state-reconciled",
    `${channel}: recorded ${recordedReleaseId ?? "(none)"} → live ${liveReleaseId}: ${reason}`,
    "leitstand",
    { releaseId: liveReleaseId, metadata: { channel, operationId: base.operationId, reason } },
  );

  return reconcileResult(
    base,
    `[leitstand.state.reconcile] ${systemId}: ${channel} reconciled — recorded ${recordedReleaseId ?? "(none)"} → live ${liveReleaseId}`,
    0,
  );
}
