/*
<MODULE_CONTRACT>
<purpose>Barrel exports for the evidence module (RFC-0651).</purpose>
<keywords>evidence, sync, fetch, r2</keywords>
<responsibilities>
  <item>Re-exports command handlers, types, and createEvidenceModule.</item>
</responsibilities>
<non-goals>
  <item>Does not define command registration — that lives in evidence-module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0651: initial barrel exports for evidence module.</item>
</CHANGE_SUMMARY>
*/

export { createEvidenceModule } from "./evidence-module.ts";
export { runEvidenceSync, type EvidenceSyncResult } from "./evidence-sync.ts";
export {
  runEvidenceFetch,
  type EvidenceFetchResult,
  type EvidenceListResult,
} from "./evidence-fetch.ts";
export {
  createR2Client,
  resolveR2ConfigFromEnv,
  MissingEnvError,
  type R2ClientConfig,
  type R2PutObjectInput,
  type R2GetObjectOutput,
  type R2ListObject,
} from "./r2-client.ts";
