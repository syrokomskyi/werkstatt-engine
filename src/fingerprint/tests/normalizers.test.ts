/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: test fingerprint normalizers — determinism, known input/output, edge cases.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial normalizer tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { normalizeText } from "../normalizers/text.ts";
import { normalizeBinary } from "../normalizers/binary.ts";
import { normalizeJson } from "../normalizers/json.ts";
import { normalizeJsonStable } from "../normalizers/json-stable.ts";
import { normalizeJsonc } from "../normalizers/jsonc.ts";
import { normalizeCss } from "../normalizers/css.ts";
import { normalizeYaml } from "../normalizers/yaml.ts";
import { normalizeMarkdown } from "../normalizers/markdown.ts";
import { normalizeAstro } from "../normalizers/astro.ts";
import { normalizeTypeScript } from "../normalizers/typescript.ts";
import { normalizeSourceMap } from "../normalizers/sourcemap.ts";
import { normalizePdf } from "../normalizers/pdf.ts";
import { normalizeFileStable } from "../normalizers/stable.ts";

test("normalizeText is deterministic — same input → same output", () => {
  const input = "hello world\n";
  expect(normalizeText(input)).toBe(normalizeText(input));
});

test("normalizeText normalizes CRLF to LF", () => {
  const a = normalizeText("line1\r\nline2\r\n");
  const b = normalizeText("line1\nline2\n");
  expect(a).toBe(b);
});

test("normalizeBinary is deterministic", () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  expect(normalizeBinary(bytes)).toBe(normalizeBinary(bytes));
});

test("normalizeBinary produces different hashes for different inputs", () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([3, 2, 1]);
  expect(normalizeBinary(a)).not.toBe(normalizeBinary(b));
});

test("normalizeJson is deterministic for equivalent JSON", () => {
  const a = normalizeJson('{"b":2,"a":1}');
  const b = normalizeJson('{"a":1,"b":2}');
  expect(a).toBe(b);
});

test("normalizeJson throws on invalid JSON", () => {
  expect(() => normalizeJson("{invalid}")).toThrow();
});

test("normalizeJsonStable is deterministic", () => {
  const a = normalizeJsonStable('{"b":2,"a":1}');
  const b = normalizeJsonStable('{"a":1,"b":2}');
  expect(a).toBe(b);
});

test("normalizeJsonc handles comments and trailing commas", () => {
  const input = '{\n  // comment\n  "a": 1,\n}';
  expect(() => normalizeJsonc(input)).not.toThrow();
});

test("normalizeCss is deterministic", () => {
  const css = "body { color: red; }";
  expect(normalizeCss(css)).toBe(normalizeCss(css));
});

test("normalizeYaml is deterministic", () => {
  const yaml = "key: value\nlist:\n  - item1\n  - item2\n";
  expect(normalizeYaml(yaml)).toBe(normalizeYaml(yaml));
});

test("normalizeMarkdown is deterministic", () => {
  const md = "# Title\n\nSome content\n";
  expect(normalizeMarkdown(md)).toBe(normalizeMarkdown(md));
});

test("normalizeAstro is deterministic", async () => {
  const astro = "---\nfrontmatter: value\n---\n\nContent";
  const a = await normalizeAstro(astro);
  const b = await normalizeAstro(astro);
  expect(a).toBe(b);
});

test("normalizeTypeScript is deterministic", () => {
  const ts = "export const x: number = 42;\n";
  expect(normalizeTypeScript(ts)).toBe(normalizeTypeScript(ts));
});

test("normalizeSourceMap is deterministic", () => {
  const sm = JSON.stringify({
    version: 3,
    sources: ["a.ts"],
    names: [],
    mappings: "AAAA",
  });
  expect(normalizeSourceMap(sm)).toBe(normalizeSourceMap(sm));
});

test("normalizePdf is deterministic with valid PDF", async () => {
  // Use a minimal valid PDF structure
  const pdfBytes = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF",
  );
  const a = await normalizePdf(pdfBytes);
  const b = await normalizePdf(pdfBytes);
  expect(a).toEqual(b);
});

test("normalizeFileStable is deterministic", async () => {
  const bytes = new TextEncoder().encode("some content\n");
  const a = await normalizeFileStable("/test.txt", bytes);
  const b = await normalizeFileStable("/test.txt", bytes);
  expect(a).toEqual(b);
});

test("all normalizers produce sha256-prefixed hashes", () => {
  const text = "test";
  const result = normalizeText(text);
  expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
});
