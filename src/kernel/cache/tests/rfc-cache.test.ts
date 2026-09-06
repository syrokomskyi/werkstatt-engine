import { test, expect, describe } from "vitest";
import {
  RFC_CACHE_NAMESPACE,
  RFC_CACHE_SCHEMA_VERSION,
  rfcCacheEntryToParsedRfc,
  type RfcCacheEntry,
} from "../rfc-cache.ts";

describe("RFC_CACHE_NAMESPACE", () => {
  test("is rfc_entries", () => {
    expect(RFC_CACHE_NAMESPACE).toBe("rfc_entries");
  });
});

describe("RFC_CACHE_SCHEMA_VERSION", () => {
  test("is 1", () => {
    expect(RFC_CACHE_SCHEMA_VERSION).toBe(1);
  });
});

describe("rfcCacheEntryToParsedRfc", () => {
  function makeEntry(overrides: Partial<RfcCacheEntry> = {}): RfcCacheEntry {
    return {
      id: "rfc-0001",
      fileName: "rfc-0001-test.md",
      status: "accepted",
      kind: "architecture",
      scope: "kernel",
      title: "Test RFC",
      owners: ["alice"],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      implementedAt: null,
      closedAt: null,
      supersedes: [],
      supersededBy: null,
      amends: [],
      amendedBy: [],
      related: [],
      satisfies: [],
      commandsProposed: [],
      commandsAdded: [],
      commandsChanged: [],
      commandsRemoved: [],
      frontmatterRaw: JSON.stringify({ id: "rfc-0001", status: "accepted" }),
      body: "## Test\n\nBody text.",
      bodyLength: 18,
      schemaVersion: 1,
      mtime: 12345,
      contentHash: "abc123",
      ...overrides,
    };
  }

  test("converts entry back to ParsedRfc shape", () => {
    const entry = makeEntry();
    const result = rfcCacheEntryToParsedRfc(entry);
    expect(result.fileName).toBe("rfc-0001-test.md");
    expect(result.parsed.frontmatter).toEqual({ id: "rfc-0001", status: "accepted" });
    expect(result.parsed.body).toBe("## Test\n\nBody text.");
  });

  test("preserves frontmatter with nested objects", () => {
    const fm = { id: "rfc-0002", commands: { proposed: ["cmd.a"] } };
    const entry = makeEntry({
      frontmatterRaw: JSON.stringify(fm),
    });
    const result = rfcCacheEntryToParsedRfc(entry);
    expect(result.parsed.frontmatter).toEqual(fm);
  });

  test("preserves body text exactly", () => {
    const body = "Some\nmulti-line\nbody\n";
    const entry = makeEntry({ body, bodyLength: body.length });
    const result = rfcCacheEntryToParsedRfc(entry);
    expect(result.parsed.body).toBe(body);
  });
});
