/*
<MODULE_CONTRACT>
<purpose>RFC-0364: Fixture validation tests for the semantic fingerprint package.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0364: initial fixture suite covering TypeScript, JSON, Markdown, and binary.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { byteHash, stableJsonHash } from "../index.ts";
import { fingerprintFile } from "../semantic.ts";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function semanticHash(relPath: string): Promise<string> {
  const result = await fingerprintFile(path.join(fixturesDir, relPath), { mode: "semantic" });
  return result.hash;
}

async function byteHashFile(relPath: string): Promise<string> {
  const result = await fingerprintFile(path.join(fixturesDir, relPath), { mode: "byte" });
  return result.hash;
}

test("TypeScript: comment-only changes keep the same semantic hash", async () => {
  const before = await semanticHash("ts-comment.before.ts");
  const after = await semanticHash("ts-comment.after.ts");
  expect(before).toBe(after);
});

test("TypeScript: meaningful AST changes alter semantic hash", async () => {
  const before = await semanticHash("ts-meaningful.before.ts");
  const after = await semanticHash("ts-meaningful.after.ts");
  expect(before).not.toBe(after);
});

test("JSON: key order changes keep the same semantic hash", async () => {
  const before = await semanticHash("json-keyorder.before.json");
  const after = await semanticHash("json-keyorder.after.json");
  expect(before).toBe(after);
});

test("JSON: value changes alter semantic hash", async () => {
  const before = await semanticHash("json-value.before.json");
  const after = await semanticHash("json-value.after.json");
  expect(before).not.toBe(after);
});

test("Markdown: trailing whitespace and HTML comments do not alter semantic hash", async () => {
  const before = await semanticHash("md-comment.before.md");
  const after = await semanticHash("md-comment.after.md");
  expect(before).toBe(after);
});

test("Markdown: fenced code block changes alter semantic hash", async () => {
  const before = await semanticHash("md-codefence.before.md");
  const after = await semanticHash("md-codefence.after.md");
  expect(before).not.toBe(after);
});

test("Binary: byte changes alter byte hash", async () => {
  const before = await byteHashFile("binary.before.bin");
  const after = await byteHashFile("binary.after.bin");
  expect(before).not.toBe(after);
});

test("byteHash produces sha256-prefixed hex", () => {
  const hash = byteHash("test");
  expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
});

test("stableJsonHash is deterministic regardless of key order", () => {
  const a = stableJsonHash({ b: 2, a: 1 });
  const b = stableJsonHash({ a: 1, b: 2 });
  expect(a).toBe(b);
});
