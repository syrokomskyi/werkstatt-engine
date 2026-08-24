/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Implements retry logic with exponential backoff for executing asynchronous functions, enhancing resilience in operations.</purpose> 
 
 
<non-goals> 
  <item>Do not implement logging or monitoring of retry attempts or failures.</item> 
  <item>Do not modify the behavior of the function being retried beyond executing it with retries.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>Added Compass scaffolding to clarify the architectural role and responsibilities of retry logic.</item>
</CHANGE_SUMMARY> 
*******************************************************************************/

export interface RetryOptions {
  /** Number of additional attempts after the first (default: 2 → 3 total). */
  retries?: number;
  /** Base delay in ms before the second attempt (default: 1000). */
  baseDelay?: number;
  /** Exponential multiplier per attempt (default: 2 → 1s, 2s, 4s). */
  factor?: number;
  /** Add up to 500ms random jitter to avoid synchronized retries (default: true). */
  jitter?: boolean;
}

/**
 * [CL-RETRY][retryWithBackoff]
 * Calls `fn` up to `retries + 1` times total.
 * Between attempts waits: baseDelay * factor^attempt [+ random jitter].
 * Throws the last error if all attempts fail.
 *
 * Delay schedule (defaults): 1 s → 2 s → 4 s (+ ≤500 ms jitter each).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { retries = 2, baseDelay = 1000, factor = 2, jitter = true } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = baseDelay * factor ** attempt + (jitter ? Math.random() * 500 : 0);
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}
