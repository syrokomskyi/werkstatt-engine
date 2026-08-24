/* 
<MODULE_CONTRACT> 
<purpose>Provides a mechanism to create rate limiters for controlling concurrent execution.</purpose> 
 
 
<non-goals> 
  <item>Do not manage the execution of tasks that are rate-limited.</item> 
  <item>Do not perform input validation on the concurrency parameter.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>Added Compass scaffolding to define the module's purpose and responsibilities.</item>
</CHANGE_SUMMARY> 
*/

import pLimit from "p-limit";

// START_BLOCK_FACTORY
/** [CL-LIMIT][createRateLimiter][CREATED] concurrency={n} */
export function createRateLimiter(n: number) {
  return pLimit(n);
}
// END_BLOCK_FACTORY
