/*
<MODULE_CONTRACT>
<purpose>
RFC-0291: best-effort per-IP fixed-window rate limiting for the Agent Gate.
In-isolate LRU counter — per-isolate, resets on eviction. Platform-level WAF
rules are a deferred phase (nonGoal for v1). Fail-open on limiter internals
(a limiter bug must not take the action tier down).
</purpose>
<non-goals>
  <item>Do not persist counters — in-memory only, short-lived.</item>
  <item>Do not implement exact cross-isolate limiting — best-effort by design.</item>
  <item>Do not move limit numbers here — they live in capability YAML only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0291: initial rate limiter.</item>
</CHANGE_SUMMARY>
*/

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

/**
 * Create a fixed-window rate limiter. Each key gets its own bucket that resets
 * after `windowSeconds`. When a bucket exceeds `maxPerWindow`, subsequent
 * requests in the same window are denied with `retryAfterSeconds` indicating
 * how long until the window resets.
 *
 * Buckets are evicted lazily — expired entries are replaced on next access.
 * The limiter is intentionally simple: no LRU eviction, no cross-isolate sync.
 */
export function createFixedWindowLimiter(windowSeconds: number, maxPerWindow: number): RateLimiter {
  const buckets = new Map<string, { count: number; expiresAt: number }>();
  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket || now >= bucket.expiresAt) {
        bucket = { count: 0, expiresAt: now + windowSeconds * 1000 };
        buckets.set(key, bucket);
      }
      bucket.count++;
      if (bucket.count > maxPerWindow) {
        const retryAfterSeconds = Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
        return { allowed: false, retryAfterSeconds };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
