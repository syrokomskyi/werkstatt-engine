/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: test YAML frontmatter parsing and serialization helpers used by migrators.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial yaml-utils test.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import {
  parseFrontmatter,
  parseSimpleYaml,
  serializeFrontmatter,
  stripQuotes,
  needsQuoting,
  yamlValue,
  escapeYamlString,
  getIndent,
} from "../yaml-utils.ts";

test("parseFrontmatter extracts frontmatter and body", () => {
  const raw = "---\ntitle: Test\n---\nBody content";
  const { frontmatter, body } = parseFrontmatter(raw);
  expect(frontmatter.title).toBe("Test");
  expect(body).toBe("Body content");
});

test("parseFrontmatter returns empty frontmatter when no delimiter", () => {
  const { frontmatter, body } = parseFrontmatter("Just body");
  expect(frontmatter).toEqual({});
  expect(body).toBe("Just body");
});

test("parseSimpleYaml parses nested objects", () => {
  const yaml = "top:\n  child: value\n  num: 42";
  const result = parseSimpleYaml(yaml);
  expect(result.top).toEqual({ child: "value", num: "42" });
});

test("parseSimpleYaml handles empty values and comments", () => {
  const yaml = "key1: value\n# comment\nkey2:";
  const result = parseSimpleYaml(yaml);
  expect(result.key1).toBe("value");
});

test("stripQuotes removes surrounding quotes", () => {
  expect(stripQuotes('"hello"')).toBe("hello");
  expect(stripQuotes("'hello'")).toBe("hello");
  expect(stripQuotes("hello")).toBe("hello");
});

test("needsQuoting detects special characters", () => {
  expect(needsQuoting("normal")).toBe(false);
  expect(needsQuoting("with: colon")).toBe(true);
  expect(needsQuoting("with# hash")).toBe(true);
  expect(needsQuoting("")).toBe(true);
  expect(needsQuoting(" leading")).toBe(true);
  expect(needsQuoting("trailing ")).toBe(true);
});

test("yamlValue quotes values that need quoting", () => {
  expect(yamlValue("normal")).toBe("normal");
  expect(yamlValue("with: colon")).toBe('"with: colon"');
});

test("escapeYamlString escapes backslashes and quotes", () => {
  expect(escapeYamlString('hello "world"')).toBe('hello \\"world\\"');
  expect(escapeYamlString("back\\slash")).toBe("back\\\\slash");
});

test("getIndent counts leading spaces", () => {
  expect(getIndent("  two")).toBe(2);
  expect(getIndent("zero")).toBe(0);
  expect(getIndent("    four")).toBe(4);
});

test("serializeFrontmatter produces valid YAML with delimiters", () => {
  const result = serializeFrontmatter({ title: "Test", count: 3 });
  expect(result.startsWith("---\n")).toBe(true);
  expect(result).toContain("---");
  expect(result).toContain("title: Test");
  expect(result).toContain("count: 3");
});

test("serializeFrontmatter skips null and undefined values", () => {
  const result = serializeFrontmatter({ a: "x", b: null, c: undefined, d: "y" });
  expect(result).toContain("a: x");
  expect(result).not.toContain("b:");
  expect(result).not.toContain("c:");
  expect(result).toContain("d: y");
});

test("serializeFrontmatter handles nested objects", () => {
  const result = serializeFrontmatter({ outer: { inner: "value" } });
  expect(result).toContain("outer:");
  expect(result).toContain("  inner: value");
});

test("round-trip: parse → serialize → parse preserves string data", () => {
  const original = "---\ntitle: Test\ncount: 42\n---\nBody";
  const { frontmatter } = parseFrontmatter(original);
  const serialized = serializeFrontmatter(frontmatter);
  const { frontmatter: roundTripped } = parseFrontmatter(serialized);
  expect(roundTripped.title).toBe("Test");
  expect(roundTripped.count).toBe("42");
});
