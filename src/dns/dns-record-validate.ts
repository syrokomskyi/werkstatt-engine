/*
<MODULE_CONTRACT>
<purpose>
RFC-0753: dns.record.validate command handler — validates that live Cloudflare
DNS records match the declaration file. Returns per-record validation status
and overall state. Exit code 0 for all validation states.
</purpose>
<non-goals>
  <item>Do not create or update records — that is dns.record.upsert's responsibility.</item>
  <item>Do not delete records — that is dns.record.delete's responsibility.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial dns.record.validate command handler.</item>
  <item>RFC-0753: live lookup falls back to the HTTPS wire-alias record for declared SVCB when no exact-type match exists at the name.</item>
  <item>RFC-0753: best-fit declared→live matching with consumed-live tracking — duplicate type+name identities (parallel MX, dual apex TXT) validate correctly, and unconsumed same-identity live records surface as extra instead of being hidden by the identity set.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { discoverSystems } from "../sternsystem/registry-io.ts";
import { listDnsRecords } from "../leitstand/adapters/cloudflare-api.ts";
import {
  flagString,
  loadDnsRecordFile,
  resolveDnsZoneId,
  resolveDnsEnv,
  recordsMatch,
  pickBestLiveMatch,
} from "./dns-helpers.ts";

export interface DnsRecordValidateResult {
  command: "dns.record.validate";
  systemId: string;
  zone: string;
  records: Array<{
    identity: string;
    state: "match" | "mismatch" | "missing" | "extra";
    liveId: string | null;
    detail: string | null;
  }>;
  state: "valid" | "drifted";
  counts: { match: number; mismatch: number; missing: number; extra: number };
}

export async function runDnsRecordValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DnsRecordValidateResult>> {
  const { workspaceRoot } = context;
  const systemId = flagString(input, "system");
  if (!systemId) throw new Error("[dns.record.validate] --system is required");

  const declaration = await loadDnsRecordFile(workspaceRoot, systemId);
  if (!declaration) {
    throw new Error(`[dns.record.validate] No dns-records.yaml found for system '${systemId}'.`);
  }

  const { systems } = await discoverSystems(workspaceRoot);
  const zoneId = resolveDnsZoneId(systems, declaration.zone);

  const env = await resolveDnsEnv();
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  if (!apiToken) {
    throw new Error(
      "[dns.record.validate] CLOUDFLARE_API_TOKEN is not set. " +
        "Set it in the environment or .env file.",
    );
  }

  const liveRecords = await listDnsRecords(zoneId, apiToken);

  const records: DnsRecordValidateResult["records"] = [];
  let match = 0;
  let mismatch = 0;
  let missing = 0;
  let extra = 0;

  const consumedLiveIds = new Set<string>();
  for (const declared of declaration.records) {
    const identity = `${declared.type}:${declared.name}`;
    const live = pickBestLiveMatch(declared, liveRecords, consumedLiveIds);

    if (!live) {
      missing++;
      records.push({ identity, state: "missing", liveId: null, detail: null });
      continue;
    }
    consumedLiveIds.add(live.id);

    if (recordsMatch(declared, live)) {
      match++;
      records.push({ identity, state: "match", liveId: live.id, detail: null });
    } else {
      mismatch++;
      const diffs: string[] = [];
      if (live.content !== declared.content) {
        diffs.push(`content: live='${live.content}' vs declared='${declared.content}'`);
      }
      if (live.proxied !== (declared.proxied ?? false)) {
        diffs.push(`proxied: live=${live.proxied} vs declared=${declared.proxied ?? false}`);
      }
      if (declared.priority !== undefined && live.priority !== declared.priority) {
        diffs.push(`priority: live=${live.priority} vs declared=${declared.priority}`);
      }
      records.push({
        identity,
        state: "mismatch",
        liveId: live.id,
        detail: diffs.join("; "),
      });
    }
  }

  for (const live of liveRecords) {
    if (!consumedLiveIds.has(live.id)) {
      const identity = `${live.type}:${live.name}`;
      extra++;
      records.push({ identity, state: "extra", liveId: live.id, detail: null });
    }
  }

  const state: DnsRecordValidateResult["state"] =
    mismatch === 0 && missing === 0 ? "valid" : "drifted";

  return {
    data: {
      command: "dns.record.validate",
      systemId,
      zone: declaration.zone,
      records,
      state,
      counts: { match, mismatch, missing, extra },
    },
    summary: `[dns.record.validate] ${systemId}: ${state} (${match} match, ${mismatch} mismatch, ${missing} missing, ${extra} extra)`,
    nextSteps:
      state === "valid"
        ? undefined
        : [
            {
              action: `Fix DNS records: ${mismatch} mismatch(es), ${missing} missing, ${extra} extra — then re-run: pnpm exec werkstatt run dns.record.validate --site ${systemId}`,
              kind: "required",
            },
          ],
  };
}
