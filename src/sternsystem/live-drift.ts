/*
<MODULE_CONTRACT>
<purpose>RFC-1297: live-channel drift detection — shared comparison between the
recorded channel state (systems-cache/&lt;id&gt;/system-state.yaml lastPropagated) and the
release actually served by each channel's build-identity.json. Owns the factored
fetch helper (previously private to leitstand-commands.ts), the PIN auth-header
builder, and the LIVE-01/LIVE-02 diagnostic projection consumed by
sternsystem.validate, leitstand.ship preflight, and leitstand.rollback.</purpose>
<non-goals>
  <item>Not a contract source of truth — callers depend on the module's exported API, not this file's internals.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1297: initial — fetchChannelBuildIdentity/buildAuthHeader moved here from leitstand/deploy-execution.ts + leitstand-commands.ts; readLiveChannelStates + liveDriftDiagnostics added.</item>
  <item>RFC-1297</item>
  <item>RFC-1297: keep the worker bundle free of live-drift and engine kernel imports</item>
</CHANGE_SUMMARY>
*/

import type { Diagnostic, WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel";
import { readSystemConfigSmart, readSystemStateSmart } from "./registry-io.ts";

import { BUILD_IDENTITY_PATH } from "./build-identity-path.ts";

export { BUILD_IDENTITY_PATH };

export type LiveChannelName = "dev" | "alt" | "main";
const LIVE_CHANNELS: readonly LiveChannelName[] = ["dev", "alt", "main"];

/** RFC-0925: Basic-auth header for PIN-protected channel endpoints. */
export function buildAuthHeader(pin: string | null | undefined): Record<string, string> {
  if (!pin) return {};
  const credentials = btoa(`warp:${pin}`);
  return { Authorization: `Basic ${credentials}` };
}

export interface ChannelBuildIdentity {
  distTreeHash: string | null;
  releaseId: string | null;
  missionId: string | null;
  buildTimestamp: string | null;
}

export interface FetchBuildIdentityResult {
  reachable: boolean;
  httpStatus: number | null;
  buildIdentity: ChannelBuildIdentity | null;
  error: string | null;
}

/**
 * Fetch a channel's build-identity.json (cache-busted). Factored out of
 * runLeitstandVerify (RFC-0930) so sternsystem.validate, ship preflight, and
 * rollback can probe the same live truth through one code path.
 */
export async function fetchChannelBuildIdentity(
  channel: LiveChannelName,
  url: string,
  authHeaders: Record<string, string>,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchBuildIdentityResult> {
  const base = url.replace(/\/$/, "");
  // RFC-1297: cache-buster defeats stale CDN copies of the identity right after
  // a deploy or out-of-band rollback.
  const fetchUrl = `${base}${BUILD_IDENTITY_PATH}?verify=${Date.now()}`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetchImpl(fetchUrl, {
      headers: authHeaders,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        reachable: response.status < 500,
        httpStatus: response.status,
        buildIdentity: null,
        error:
          response.status === 404 ? "build-identity.json not found" : `HTTP ${response.status}`,
      };
    }
    const body = (await response.json()) as {
      distTreeHash?: string;
      releaseId?: string;
      missionId?: string;
      buildTimestamp?: string;
    };
    return {
      reachable: true,
      httpStatus: response.status,
      buildIdentity: {
        distTreeHash: body.distTreeHash ?? null,
        releaseId: body.releaseId ?? null,
        missionId: body.missionId ?? null,
        buildTimestamp: body.buildTimestamp ?? null,
      },
      error: null,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      reachable: false,
      httpStatus: null,
      buildIdentity: null,
      error: isAbort
        ? `timeout after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ChannelLiveState {
  channel: LiveChannelName;
  /** releaseId recorded in system-state.yaml lastPropagated — the believed-live release. */
  recordedReleaseId: string | null;
  /** releaseId served by the channel's live build-identity.json — null when unreachable or identity missing. */
  liveReleaseId: string | null;
  /** true when the channel answered with an HTTP status (even 4xx). */
  reachable: boolean;
  error: string | null;
}

/**
 * Read every channel that has a recorded lastPropagated entry and compare the
 * recorded releaseId against the live build-identity.json releaseId. Channels
 * with no lastPropagated entry are skipped — never deployed, nothing to drift
 * from.
 */
export async function readLiveChannelStates(ctx: {
  workspaceRoot: string;
  systemId: string;
  io: WorkspaceIO;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ChannelLiveState[]> {
  const { workspaceRoot, systemId, io } = ctx;
  const timeoutMs = ctx.timeoutMs ?? 10_000;
  const fetchImpl = ctx.fetchImpl ?? fetch;

  const systemConfig = await readSystemConfigSmart(workspaceRoot, systemId, io);
  const channels = systemConfig.deployment?.channels;
  if (!channels) return [];

  const systemState = await readSystemStateSmart(workspaceRoot, systemId, io);
  const authHeaders = buildAuthHeader(systemState.accessPin);

  const states: ChannelLiveState[] = [];
  for (const channel of LIVE_CHANNELS) {
    const recorded = systemState.lastPropagated?.[channel];
    if (!recorded) continue;
    const url = channels[channel]?.url;
    if (!url) continue;
    const result = await fetchChannelBuildIdentity(channel, url, authHeaders, timeoutMs, fetchImpl);
    states.push({
      channel,
      recordedReleaseId: recorded.releaseId ?? null,
      liveReleaseId: result.buildIdentity?.releaseId ?? null,
      reachable: result.reachable,
      error: result.error,
    });
  }
  return states;
}

/**
 * LIVE-01 (error): live releaseId differs from the recorded one — an
 * out-of-band deploy or rollback happened.
 * LIVE-02 (warning): the channel is unreachable or returns no identity — the
 * probe is inconclusive, never a violation.
 */
export function liveDriftDiagnostics(states: ChannelLiveState[], systemId: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const state of states) {
    if (state.liveReleaseId === null) {
      diagnostics.push({
        ruleId: "LIVE-02",
        severity: "warning",
        message: `${state.channel}: live release probe inconclusive for ${systemId} — ${state.error ?? "no build-identity"}`,
      });
      continue;
    }
    if (state.recordedReleaseId !== null && state.liveReleaseId !== state.recordedReleaseId) {
      diagnostics.push({
        ruleId: "LIVE-01",
        severity: "error",
        message: `${state.channel}: live release ${state.liveReleaseId} ≠ recorded ${state.recordedReleaseId} — an out-of-band deploy or rollback happened`,
        fixHint: `Inspect with leitstand.verify --site ${systemId}; then either redeploy the recorded release via the pipeline, or record reality with leitstand.state.reconcile --site ${systemId} --channel ${state.channel} --from-live --reason "…" (operator approval).`,
      });
    }
  }
  return diagnostics;
}
