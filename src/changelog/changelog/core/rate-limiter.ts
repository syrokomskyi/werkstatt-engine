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

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY> 
*/

import pLimit from "p-limit";

// START_BLOCK_FACTORY
/** [CL-LIMIT][createRateLimiter][CREATED] concurrency={n} */
export function createRateLimiter(n: number) {
  return pLimit(n);
}
// END_BLOCK_FACTORY
