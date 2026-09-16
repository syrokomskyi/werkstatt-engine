/*
<MODULE_CONTRACT>
<purpose>evidence index — barrel exports for the evidence module command family (RFC-0651).</purpose>


<non-goals>
  <item>Does not define command registration — that lives in evidence-module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0651: initial barrel exports for evidence module.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
