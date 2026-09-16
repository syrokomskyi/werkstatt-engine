/*
<MODULE_CONTRACT>
<purpose>dns index — barrel export for the DNS record management command family (RFC-0753).</purpose>
<non-goals>
  <item>Do not re-export Cloudflare API client functions — those live in leitstand/adapters.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial DNS module barrel.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export { normalizeTxtContent, ensureTxtQuoted } from "./txt-normalize.ts";
export {
  flagString,
  flagBoolean,
  loadDnsRecordFile,
  resolveDnsZoneId,
  resolveDnsEnv,
  resolveZoneDomainForSystem,
  recordIdentity,
  recordsMatch,
} from "./dns-helpers.ts";
export { runDnsRecordUpsert, type DnsRecordUpsertResult } from "./dns-record-upsert.ts";
export { runDnsRecordValidate, type DnsRecordValidateResult } from "./dns-record-validate.ts";
export { runDnsRecordList, type DnsRecordListResult } from "./dns-record-list.ts";
export { runDnsRecordDelete, type DnsRecordDeleteResult } from "./dns-record-delete.ts";
export {
  runDnsRecordsSchemaValidate,
  type DnsRecordsSchemaValidateResult,
} from "./dns-records-schema-validate.ts";
export { createDnsModule } from "./dns.module.ts";
