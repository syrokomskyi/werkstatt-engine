/* 
<MODULE_CONTRACT> 
<purpose>Provides a mechanism to create rate limiters for controlling concurrent execution.</purpose> 
 
 
<non-goals> 
  <item>Do not manage the execution of tasks that are rate-limited.</item> 
  <item>Do not perform input validation on the concurrency parameter.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY> 
*/

import pLimit from "p-limit";

// START_BLOCK_FACTORY
/** [CL-LIMIT][createRateLimiter][CREATED] concurrency={n} */
export function createRateLimiter(n: number) {
  return pLimit(n);
}
// END_BLOCK_FACTORY
