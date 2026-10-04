/*
<MODULE_CONTRACT>
<purpose>
RFC-0753: Shared helpers for DNS record commands — declaration file loading,
zone ID resolution, environment variable resolution, and record identity.
</purpose>
<non-goals>
  <item>Do not implement command logic — that lives in the individual command files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial DNS helpers — loadDnsRecordFile, resolveDnsZoneId, resolveDnsEnv, recordIdentity.</item>
  <item>RFC-0753: recordsMatch — SVCB/HTTPS rdata parse-compare via svcb-normalize (AGD-05 subset params, HTTPS satisfies declared SVCB), replacing literal compare that flagged Cloudflare presentation normalization as drift.</item>
  <item>RFC-0753: pickBestLiveMatch — best-fit declared→live selection for duplicate type+name identities, extracted from dns.record.validate for unit testing.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { dnsRecordFileSchema } from "@warpgogol/werkstatt-shared/ontology/schemas";
import type {
  DnsRecordDeclaration,
  DnsRecordFile,
} from "@warpgogol/werkstatt-shared/ontology/schemas";
import { isSvcbType, svcbContentsMatch } from "./svcb-normalize.ts";
import { filterEnv, sourceDotenv } from "../leitstand/adapters/cloudflare-workers.ts";
import { resolveZoneId } from "../subdomain/subdomain-helpers.ts";
import { resolveCacheClonePath } from "../sternsystem/registry-io.ts";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export { resolveZoneId as resolveDnsZoneId };

export function flagString(
  input: { flags: Record<string, unknown> },
  key: string,
): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export function flagBoolean(
  input: { flags: Record<string, unknown> },
  key: string,
): boolean | undefined {
  const v = input.flags[key];
  return typeof v === "boolean" ? v : undefined;
}

export async function loadDnsRecordFile(
  workspaceRoot: string,
  systemId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<DnsRecordFile | null> {
  const cacheDir = resolveCacheClonePath(workspaceRoot, systemId);
  const filePath = join(cacheDir, "dns-records.yaml");
  let raw: string;
  try {
    raw = await io.readFile(filePath);
  } catch {
    return null;
  }
  const { parse } = await import("yaml");
  const parsed = parse(raw);
  return dnsRecordFileSchema.parse(parsed) as DnsRecordFile;
}

export async function resolveDnsEnv(secretsFilePath?: string): Promise<Record<string, string>> {
  const secretsEnv = secretsFilePath ? await sourceDotenv(secretsFilePath) : {};
  return { ...filterEnv(process.env), ...secretsEnv };
}

export function resolveZoneDomainForSystem(
  systems: Array<{ id: string; deployment?: { channels: { main: { url: string } } } }>,
  systemId: string,
): string {
  for (const system of systems) {
    if (system.id !== systemId) continue;
    if (!system.deployment) continue;
    try {
      return new URL(system.deployment.channels.main.url).hostname;
    } catch {
      continue;
    }
  }
  throw new Error(`[dns] Could not resolve zone domain for system '${systemId}'.`);
}

export function recordIdentity(record: DnsRecordDeclaration): string {
  return `${record.type}:${record.name}`;
}

export function recordsMatch(
  declared: DnsRecordDeclaration,
  live: {
    type: string;
    name: string;
    content: string;
    proxied: boolean;
    priority: number | null;
    ttl?: number | null;
  },
): boolean {
  if (live.type !== declared.type && !(declared.type === "SVCB" && live.type === "HTTPS")) {
    return false;
  }
  if (live.name !== declared.name) return false;

  // SVCB/HTTPS rdata is presentation-normalized by Cloudflare (trailing dot on
  // the canonical target, quoted params) — parse-compare instead of literal
  // compare, with declared ⊆ live param semantics per AGD-05.
  if (isSvcbType(declared.type)) {
    if (!svcbContentsMatch(declared.content, live.type, live.content)) return false;
  } else {
    const declaredContent =
      declared.type === "TXT" ? normalizeTxtForCompare(declared.content) : declared.content;
    const liveContent =
      declared.type === "TXT" ? normalizeTxtForCompare(live.content) : live.content;
    if (declaredContent !== liveContent) return false;
  }

  const declaredProxied = declared.proxied ?? false;
  if (live.proxied !== declaredProxied) return false;

  if (declared.priority !== undefined && declared.priority !== live.priority) {
    return false;
  }

  if (declared.ttl !== undefined && live.ttl !== declared.ttl) {
    return false;
  }

  return true;
}

/**
 * Best-fit declared→live matching: multiple live records may share a type+name
 * identity (parallel MX, dual TXT at apex). Pick the unconsumed live record that
 * fully matches the declaration; fall back to the first candidate so the caller
 * still has a live record for mismatch detail. A live HTTPS record is a
 * candidate for a declared SVCB (wire alias).
 */
export function pickBestLiveMatch(
  declared: DnsRecordDeclaration,
  liveRecords: Array<{
    id: string;
    type: string;
    name: string;
    content: string;
    proxied: boolean;
    priority: number | null;
    ttl?: number | null;
  }>,
  consumedLiveIds: ReadonlySet<string>,
): (typeof liveRecords)[number] | undefined {
  const candidates = liveRecords.filter(
    (r) =>
      !consumedLiveIds.has(r.id) &&
      r.name === declared.name &&
      (r.type === declared.type || (declared.type === "SVCB" && isSvcbType(r.type))),
  );
  return candidates.find((r) => recordsMatch(declared, r)) ?? candidates[0];
}

function normalizeTxtForCompare(content: string): string {
  return content
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\([.;()])|(["'])/g, "$1")
    .trim()
    .replace(/\s+/g, " ");
}
