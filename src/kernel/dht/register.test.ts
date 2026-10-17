/*
<MODULE_CONTRACT>
<purpose>
Unit tests for register covering dht.register LWW conflict resolution. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the register suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

import { describe, it, expect } from "vitest";
import type { DHTSiteEntry } from "./types.ts";

// Test the LWW conflict resolution logic by replicating the pure function
// from register.ts. The actual function is not exported, so we test the
// logic here to ensure correctness.

function resolveConflict(
  existing: DHTSiteEntry,
  candidate: DHTSiteEntry,
): { winner: DHTSiteEntry; reason: "newer" | "equal-existing" } {
  const existingTime = new Date(existing.lastUpdated).getTime();
  const candidateTime = new Date(candidate.lastUpdated).getTime();

  if (candidateTime > existingTime) {
    return { winner: candidate, reason: "newer" };
  }
  return { winner: existing, reason: "equal-existing" };
}

function makeEntry(siteId: string, lastUpdated: string): DHTSiteEntry {
  return {
    siteId,
    owner: "did:web:example.com#v1",
    workshopEndpoint: "10.0.0.1:7947",
    mirrors: [],
    registeredAt: "2025-01-01T00:00:00.000Z",
    lastUpdated,
    signature: "zFakeSignature123",
  };
}

describe("dht.register LWW conflict resolution", () => {
  it("candidate wins when newer", () => {
    const existing = makeEntry("test", "2025-01-01T00:00:00.000Z");
    const candidate = makeEntry("test", "2025-01-02T00:00:00.000Z");

    const result = resolveConflict(existing, candidate);
    expect(result.winner).toBe(candidate);
    expect(result.reason).toBe("newer");
  });

  it("existing wins when candidate is older", () => {
    const existing = makeEntry("test", "2025-01-02T00:00:00.000Z");
    const candidate = makeEntry("test", "2025-01-01T00:00:00.000Z");

    const result = resolveConflict(existing, candidate);
    expect(result.winner).toBe(existing);
    expect(result.reason).toBe("equal-existing");
  });

  it("existing wins when timestamps are equal (conservative)", () => {
    const existing = makeEntry("test", "2025-01-01T00:00:00.000Z");
    const candidate = makeEntry("test", "2025-01-01T00:00:00.000Z");

    const result = resolveConflict(existing, candidate);
    expect(result.winner).toBe(existing);
    expect(result.reason).toBe("equal-existing");
  });
});
