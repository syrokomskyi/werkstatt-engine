/*
<MODULE_CONTRACT>
  <purpose>RFC-0656: Unit tests for stable-mode normalizers (PDF, source map, JSON) and fingerprintTree stable mode.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0656: initial stable normalizer test suite.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

import { fingerprintTree } from "../semantic.ts";
import { normalizePdf } from "../normalizers/pdf.ts";
import { normalizeSourceMap } from "../normalizers/sourcemap.ts";
import { normalizeJsonStable } from "../normalizers/json-stable.ts";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "fingerprint-stable-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function createPdfWithMetadata(creationDate: Date, modDate: Date): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 300]);
  pdf.setCreationDate(creationDate);
  pdf.setModificationDate(modDate);
  return pdf.save();
}

test("PDF: identical PDFs produce identical normalized bytes", async () => {
  const pdf1 = await createPdfWithMetadata(
    new Date("2026-01-01T00:00:00Z"),
    new Date("2026-01-01T00:00:00Z"),
  );
  const pdf2 = await createPdfWithMetadata(
    new Date("2026-01-01T00:00:00Z"),
    new Date("2026-01-01T00:00:00Z"),
  );

  const norm1 = await normalizePdf(pdf1);
  const norm2 = await normalizePdf(pdf2);

  expect(Buffer.from(norm1).toString("hex")).toBe(Buffer.from(norm2).toString("hex"));
});

test("PDF: different timestamps produce identical normalized bytes", async () => {
  const pdf1 = await createPdfWithMetadata(
    new Date("2026-01-01T00:00:00Z"),
    new Date("2026-01-01T00:00:00Z"),
  );
  const pdf2 = await createPdfWithMetadata(
    new Date("2026-06-15T12:30:00Z"),
    new Date("2026-06-15T12:30:00Z"),
  );

  const norm1 = await normalizePdf(pdf1);
  const norm2 = await normalizePdf(pdf2);

  expect(Buffer.from(norm1).toString("hex")).toBe(Buffer.from(norm2).toString("hex"));
});

test("PDF: normalized bytes differ from original (metadata stripped)", async () => {
  const pdf = await createPdfWithMetadata(
    new Date("2026-01-01T00:00:00Z"),
    new Date("2026-01-01T00:00:00Z"),
  );
  const normalized = await normalizePdf(pdf);

  expect(Buffer.from(normalized).toString("hex")).not.toBe(Buffer.from(pdf).toString("hex"));
});

test("Source map: absolute paths normalized to relative produce same hash", () => {
  const map1 = JSON.stringify({
    version: 3,
    sources: ["/home/user/project/src/index.ts", "/home/user/project/src/helper.ts"],
    sourceRoot: "/home/user/project/",
    mappings: "AAAA",
    names: ["foo", "bar"],
  });
  const map2 = JSON.stringify({
    version: 3,
    sources: ["/opt/build/project/src/index.ts", "/opt/build/project/src/helper.ts"],
    sourceRoot: "/opt/build/project/",
    mappings: "AAAA",
    names: ["foo", "bar"],
  });

  const distRoot1 = "/home/user/project";
  const distRoot2 = "/opt/build/project";

  const hash1 = normalizeSourceMap(map1, distRoot1);
  const hash2 = normalizeSourceMap(map2, distRoot2);

  expect(hash1).toBe(hash2);
});

test("Source map: sourceRoot is stripped", () => {
  const mapWithRoot = JSON.stringify({
    version: 3,
    sources: ["src/index.ts"],
    sourceRoot: "/some/absolute/path/",
    mappings: "AAAA",
  });
  const mapWithoutRoot = JSON.stringify({
    version: 3,
    sources: ["src/index.ts"],
    mappings: "AAAA",
  });

  const hash1 = normalizeSourceMap(mapWithRoot, "/dummy");
  const hash2 = normalizeSourceMap(mapWithoutRoot, "/dummy");

  expect(hash1).toBe(hash2);
});

test("Source map: content changes alter hash", () => {
  const map1 = JSON.stringify({ version: 3, sources: ["src/a.ts"], mappings: "AAAA" });
  const map2 = JSON.stringify({ version: 3, sources: ["src/b.ts"], mappings: "AAAA" });

  const hash1 = normalizeSourceMap(map1, "/dummy");
  const hash2 = normalizeSourceMap(map2, "/dummy");

  expect(hash1).not.toBe(hash2);
});

test("JSON stable: timestamp fields removed produce same hash", () => {
  const json1 = JSON.stringify({ name: "test", createdAt: "2026-01-01T00:00:00Z", value: 42 });
  const json2 = JSON.stringify({ name: "test", buildTimestamp: "2026-06-15T12:00:00Z", value: 42 });

  const hash1 = normalizeJsonStable(json1);
  const hash2 = normalizeJsonStable(json2);

  expect(hash1).toBe(hash2);
});

test("JSON stable: key order does not affect hash", () => {
  const json1 = JSON.stringify({ b: 2, a: 1, createdAt: "2026-01-01" });
  const json2 = JSON.stringify({ a: 1, b: 2, generatedAt: "2026-06-15" });

  const hash1 = normalizeJsonStable(json1);
  const hash2 = normalizeJsonStable(json2);

  expect(hash1).toBe(hash2);
});

test("JSON stable: content changes alter hash", () => {
  const json1 = JSON.stringify({ name: "test", createdAt: "2026-01-01" });
  const json2 = JSON.stringify({ name: "changed", createdAt: "2026-01-01" });

  const hash1 = normalizeJsonStable(json1);
  const hash2 = normalizeJsonStable(json2);

  expect(hash1).not.toBe(hash2);
});

test("JSON stable: nested timestamp fields are stripped", () => {
  const json1 = JSON.stringify({ outer: { inner: "value", createdAt: "2026-01-01" } });
  const json2 = JSON.stringify({ outer: { inner: "value", buildTimestamp: "2026-06-15" } });

  const hash1 = normalizeJsonStable(json1);
  const hash2 = normalizeJsonStable(json2);

  expect(hash1).toBe(hash2);
});

test("fingerprintTree stable: two builds with different timestamps produce identical distTreeHash", async () => {
  const dir1 = path.join(tmpDir, "build1");
  const dir2 = path.join(tmpDir, "build2");
  await mkdir(dir1, { recursive: true });
  await mkdir(dir2, { recursive: true });

  const pdf1 = await createPdfWithMetadata(new Date("2026-01-01"), new Date("2026-01-01"));
  const pdf2 = await createPdfWithMetadata(new Date("2026-06-15"), new Date("2026-06-15"));

  await writeFile(path.join(dir1, "document.pdf"), pdf1);
  await writeFile(path.join(dir2, "document.pdf"), pdf2);

  await writeFile(
    path.join(dir1, "index.js.map"),
    JSON.stringify({
      version: 3,
      sources: ["../src/index.ts", "../src/helper.ts"],
      mappings: "AAAA",
      createdAt: "2026-01-01",
    }),
  );
  await writeFile(
    path.join(dir2, "index.js.map"),
    JSON.stringify({
      version: 3,
      sources: ["../src/index.ts", "../src/helper.ts"],
      mappings: "AAAA",
      buildTimestamp: "2026-06-15",
    }),
  );

  await writeFile(
    path.join(dir1, "build-identity.json"),
    JSON.stringify({ releaseId: "r001", createdAt: "2026-01-01T00:00:00Z" }),
  );
  await writeFile(
    path.join(dir2, "build-identity.json"),
    JSON.stringify({ releaseId: "r001", generatedAt: "2026-06-15T12:00:00Z" }),
  );

  await writeFile(path.join(dir1, "index.html"), "<html><body>Hello</body></html>");
  await writeFile(path.join(dir2, "index.html"), "<html><body>Hello</body></html>");

  const result1 = await fingerprintTree(dir1, { mode: "stable", root: dir1 });
  const result2 = await fingerprintTree(dir2, { mode: "stable", root: dir2 });

  expect(result1.value).toBe(result2.value);
  expect(result1.mode).toBe("stable");
});

test("fingerprintTree stable: content changes alter distTreeHash", async () => {
  const dir1 = path.join(tmpDir, "build1");
  const dir2 = path.join(tmpDir, "build2");
  await mkdir(dir1, { recursive: true });
  await mkdir(dir2, { recursive: true });

  await writeFile(path.join(dir1, "index.html"), "<html><body>Hello</body></html>");
  await writeFile(path.join(dir2, "index.html"), "<html><body>Goodbye</body></html>");

  const result1 = await fingerprintTree(dir1, { mode: "stable", root: dir1 });
  const result2 = await fingerprintTree(dir2, { mode: "stable", root: dir2 });

  expect(result1.value).not.toBe(result2.value);
});

test("fingerprintTree stable: empty directory produces deterministic hash", async () => {
  const dir = path.join(tmpDir, "empty");
  await mkdir(dir, { recursive: true });

  const result1 = await fingerprintTree(dir, { mode: "stable", root: dir });
  const result2 = await fingerprintTree(dir, { mode: "stable", root: dir });

  expect(result1.value).toBe(result2.value);
  expect(result1.files).toHaveLength(0);
});

test("fingerprintTree stable: corrupt PDF falls back to byte hash with warning", async () => {
  const dir = path.join(tmpDir, "corrupt");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "bad.pdf"), Buffer.from("not a real pdf"));

  const result = await fingerprintTree(dir, { mode: "stable", root: dir });

  expect(result.warnings).toBeDefined();
  expect(result.warnings!.length).toBeGreaterThan(0);
  expect(result.files[0]!.mode).toBe("byte");
  expect(result.files[0]!.normalizer).toBe("binary");
});
