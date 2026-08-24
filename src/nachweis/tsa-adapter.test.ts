/*
<MODULE_CONTRACT>
  <purpose>Unit test for encodeTimestampReq — verifies TSQ size is within RFC 3161 norms (≤ 200 bytes).
  Catches the Buffer.shared-pool bug where Buffer.from(hex, "hex").buffer returned 8192 bytes
  instead of 32, producing a 8242-byte TSQ that FreeTSA rejected with HTTP 404.</purpose>
</MODULE_CONTRACT>
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
