/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for tsa adapter covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the tsa suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { encodeTimestampReq } from "./tsa-adapter.ts";

test("encodeTimestampReq produces a TSQ ≤ 200 bytes for a 64-byte message", async () => {
  const signature = new Uint8Array(64);
  crypto.getRandomValues(signature);
  const tsq = await encodeTimestampReq(signature);
  expect(tsq.length).toBeLessThanOrEqual(200);
  expect(tsq.length).toBeGreaterThan(50);
});

test("encodeTimestampReq produces a TSQ ≤ 200 bytes for a 32-byte message", async () => {
  const hash = new Uint8Array(32);
  crypto.getRandomValues(hash);
  const tsq = await encodeTimestampReq(hash);
  expect(tsq.length).toBeLessThanOrEqual(200);
  expect(tsq.length).toBeGreaterThan(50);
});

test("encodeTimestampReq TSQ starts with ASN.1 SEQUENCE tag (0x30)", async () => {
  const signature = new Uint8Array(64);
  crypto.getRandomValues(signature);
  const tsq = await encodeTimestampReq(signature);
  expect(tsq[0]).toBe(0x30);
});
