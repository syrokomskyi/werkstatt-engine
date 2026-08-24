/*
<MODULE_CONTRACT>
  <purpose>RFC-0753: unit tests for TXT content normalization utility.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial TXT normalization tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { normalizeTxtContent, ensureTxtQuoted } from "./txt-normalize.ts";

test("normalizeTxtContent: strips surrounding double quotes", () => {
  expect(normalizeTxtContent('"v=spf1 include:_spf.mx.cloudflare.net ~all"')).toBe(
    "v=spf1 include:_spf.mx.cloudflare.net ~all",
  );
});

test("normalizeTxtContent: strips surrounding single quotes", () => {
  expect(normalizeTxtContent("'v=DMARC1; p=quarantine'")).toBe("v=DMARC1; p=quarantine");
});

test("normalizeTxtContent: collapses internal whitespace", () => {
  expect(normalizeTxtContent("v=spf1  include:_spf   ~all")).toBe("v=spf1 include:_spf ~all");
});

test("normalizeTxtContent: unescapes quoted special chars", () => {
  expect(normalizeTxtContent('"v=DKIM1\\; k=rsa\\; p=MIGfMA0"')).toBe("v=DKIM1; k=rsa; p=MIGfMA0");
});

test("normalizeTxtContent: handles empty string", () => {
  expect(normalizeTxtContent("")).toBe("");
});

test("normalizeTxtContent: handles already-normalized content", () => {
  expect(normalizeTxtContent("v=spf1 -all")).toBe("v=spf1 -all");
});

test("normalizeTxtContent: trims leading/trailing whitespace", () => {
  expect(normalizeTxtContent('  "v=spf1 ~all"  ')).toBe("v=spf1 ~all");
});

test("ensureTxtQuoted: wraps unquoted content in double quotes", () => {
  expect(ensureTxtQuoted("v=spf1 -all")).toBe('"v=spf1 -all"');
});

test("ensureTxtQuoted: re-quotes already-quoted content consistently", () => {
  expect(ensureTxtQuoted('"v=spf1 -all"')).toBe('"v=spf1 -all"');
});

test("ensureTxtQuoted: escapes internal double quotes", () => {
  expect(ensureTxtQuoted('v=spf1 "include:_spf"')).toBe('"v=spf1 \\"include:_spf\\""');
});

test("ensureTxtQuoted: collapses whitespace before quoting", () => {
  expect(ensureTxtQuoted("v=spf1  include:_spf   ~all")).toBe('"v=spf1 include:_spf ~all"');
});

test("ensureTxtQuoted: handles empty string", () => {
  expect(ensureTxtQuoted("")).toBe('""');
});
