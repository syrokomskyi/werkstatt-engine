/*
<MODULE_CONTRACT>
<purpose>
RFC-0753: Barrel export for DNS record management commands.
</purpose>
<non-goals>
  <item>Do not re-export Cloudflare API client functions — those live in leitstand/adapters.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial DNS module barrel.</item>
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
