import { describe, it, expect } from "vitest";
import { deriveInstanceId } from "@warpgogol/werkstatt-engine/fleet";

describe("RFC-0967: deriveInstanceId", () => {
  it("returns a 16-char hex string from a public key", () => {
    const publicKey = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const id = deriveInstanceId(publicKey);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — same key produces same id", () => {
    const publicKey = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const id1 = deriveInstanceId(publicKey);
    const id2 = deriveInstanceId(publicKey);
    expect(id1).toBe(id2);
  });

  it("produces different ids for different keys", () => {
    const key1 = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const key2 = "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5";
    expect(deriveInstanceId(key1)).not.toBe(deriveInstanceId(key2));
  });
});
