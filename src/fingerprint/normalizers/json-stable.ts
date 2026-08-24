/*
<MODULE_CONTRACT>
  <purpose>RFC-0656: JSON stable normalizer — removes non-deterministic timestamp fields and sorts keys before hashing.</purpose>
  <non-goals>
    <item>Do not remove fields other than known timestamp keys (createdAt, buildTimestamp, generatedAt).</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0656: initial JSON stable normalizer.</item>
</CHANGE_SUMMARY>
*/

import { stableJsonHash } from "../primitives.ts";

const NON_DETERMINISTIC_KEYS = new Set(["createdAt", "buildTimestamp", "generatedAt"]);

function stripTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTimestamps);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !NON_DETERMINISTIC_KEYS.has(key))
        .map(([key, nested]) => [key, stripTimestamps(nested)]),
    );
  }
  return value;
}

export function normalizeJsonStable(content: string): string {
  const parsed = JSON.parse(content);
  return stableJsonHash(stripTimestamps(parsed));
}
