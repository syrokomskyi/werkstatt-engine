/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0812: Unit tests for toApiRecord covering SVCB, HTTPS, A, AAAA, TXT,
    CNAME record types, optional fields, and edge cases.
    RFC-0817: Unit test for graceful skip when dns-records.yaml is absent.
  </purpose>
  <non-goals>
    <item>Do not test the full dns.record.upsert pipeline — that requires Cloudflare API credentials.</item>
    <item>Do not fix quoted-value parsing in SVCB/HTTPS content — documented as known issue, requires its own RFC.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0812: initial unit tests for toApiRecord.</item>
  <item>RFC-0817: add graceful skip test for missing dns-records.yaml.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi } from "vitest";
import { toApiRecord, runDnsRecordUpsert } from "./dns-record-upsert.ts";
import type { DnsRecordDeclaration } from "@warpgogol/werkstatt-shared/ontology/schemas";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

vi.mock("./dns-helpers.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./dns-helpers.ts")>();
  return {
    ...original,
    loadDnsRecordFile: vi.fn().mockResolvedValue(null),
  };
});

function rec(
  overrides: Partial<DnsRecordDeclaration> &
    Pick<DnsRecordDeclaration, "type" | "name" | "content">,
): DnsRecordDeclaration {
  return {
    proxied: false,
    ...overrides,
  };
}

describe("toApiRecord — SVCB records", () => {
  it("parses content into data object with priority, target, value", () => {
    const result = toApiRecord(
      rec({
        type: "SVCB",
        name: "_dns.resolver.example.com",
        content: "1 . alpn=h2 dohpath=/dns-query{?dns}",
      }),
    );
    expect(result.type).toBe("SVCB");
    expect(result.content).toBeUndefined();
    expect(result.data).toEqual({
      priority: 1,
      target: ".",
      value: "alpn=h2 dohpath=/dns-query{?dns}",
    });
    expect(result.proxied).toBe(false);
  });

  it("handles content with only priority and target (value = empty)", () => {
    const result = toApiRecord(
      rec({
        type: "SVCB",
        name: "_dns.resolver.example.com",
        content: "1 .",
      }),
    );
    expect(result.data).toEqual({
      priority: 1,
      target: ".",
      value: "",
    });
  });

  it("handles content with only priority (target = dot, value = empty)", () => {
    const result = toApiRecord(
      rec({
        type: "SVCB",
        name: "_dns.resolver.example.com",
        content: "1",
      }),
    );
    expect(result.data).toEqual({
      priority: 1,
      target: ".",
      value: "",
    });
  });

  it("handles empty content", () => {
    const result = toApiRecord(
      rec({
        type: "SVCB",
        name: "_dns.resolver.example.com",
        content: "",
      }),
    );
    expect(result.data).toEqual({
      priority: NaN,
      target: ".",
      value: "",
    });
  });

  it("includes ttl and comment when present", () => {
    const result = toApiRecord(
      rec({
        type: "SVCB",
        name: "_dns.resolver.example.com",
        content: "1 . alpn=h2",
        ttl: 300,
        comment: "test record",
      }),
    );
    expect(result.ttl).toBe(300);
    expect(result.comment).toBe("test record");
  });

  it("omits ttl and comment when absent", () => {
    const result = toApiRecord(
      rec({
        type: "SVCB",
        name: "_dns.resolver.example.com",
        content: "1 . alpn=h2",
      }),
    );
    expect(result.ttl).toBeUndefined();
    expect(result.comment).toBeUndefined();
  });
});

describe("toApiRecord — HTTPS records", () => {
  it("parses content into data object", () => {
    const result = toApiRecord(
      rec({
        type: "HTTPS",
        name: "example.com",
        content: "1 . alpn=h2",
      }),
    );
    expect(result.type).toBe("HTTPS");
    expect(result.content).toBeUndefined();
    expect(result.data).toEqual({
      priority: 1,
      target: ".",
      value: "alpn=h2",
    });
  });

  it("handles content with only priority and target", () => {
    const result = toApiRecord(
      rec({
        type: "HTTPS",
        name: "example.com",
        content: "1 .",
      }),
    );
    expect(result.data).toEqual({
      priority: 1,
      target: ".",
      value: "",
    });
  });
});

describe("toApiRecord — A records", () => {
  it("passes content through without data object", () => {
    const result = toApiRecord(
      rec({
        type: "A",
        name: "example.com",
        content: "192.0.2.1",
        proxied: true,
      }),
    );
    expect(result.type).toBe("A");
    expect(result.content).toBe("192.0.2.1");
    expect(result.data).toBeUndefined();
    expect(result.proxied).toBe(true);
  });
});

describe("toApiRecord — AAAA records", () => {
  it("passes content through without data object", () => {
    const result = toApiRecord(
      rec({
        type: "AAAA",
        name: "example.com",
        content: "2001:db8::1",
      }),
    );
    expect(result.type).toBe("AAAA");
    expect(result.content).toBe("2001:db8::1");
    expect(result.data).toBeUndefined();
  });
});

describe("toApiRecord — TXT records", () => {
  it("wraps unquoted TXT content in double quotes", () => {
    const result = toApiRecord(
      rec({
        type: "TXT",
        name: "example.com",
        content: "v=spf1 -all",
      }),
    );
    expect(result.content).toBe('"v=spf1 -all"');
    expect(result.data).toBeUndefined();
  });

  it("preserves already-quoted TXT content (re-quotes consistently)", () => {
    const result = toApiRecord(
      rec({
        type: "TXT",
        name: "example.com",
        content: '"v=spf1 -all"',
      }),
    );
    expect(result.content).toBe('"v=spf1 -all"');
  });

  it("escapes internal double quotes in TXT content", () => {
    const result = toApiRecord(
      rec({
        type: "TXT",
        name: "example.com",
        content: 'v=spf1 "include:_spf"',
      }),
    );
    expect(result.content).toBe('"v=spf1 \\"include:_spf\\""');
  });
});

describe("toApiRecord — CNAME records", () => {
  it("passes content through without data object", () => {
    const result = toApiRecord(
      rec({
        type: "CNAME",
        name: "www.example.com",
        content: "example.com",
      }),
    );
    expect(result.type).toBe("CNAME");
    expect(result.content).toBe("example.com");
    expect(result.data).toBeUndefined();
  });
});

describe("toApiRecord — optional fields", () => {
  it("includes priority (non-SVCB) when present", () => {
    const result = toApiRecord(
      rec({
        type: "A",
        name: "example.com",
        content: "192.0.2.1",
        priority: 10,
      }),
    );
    expect(result.priority).toBe(10);
  });

  it("omits priority (non-SVCB) when absent", () => {
    const result = toApiRecord(
      rec({
        type: "A",
        name: "example.com",
        content: "192.0.2.1",
      }),
    );
    expect(result.priority).toBeUndefined();
  });

  it("includes ttl when present", () => {
    const result = toApiRecord(
      rec({
        type: "A",
        name: "example.com",
        content: "192.0.2.1",
        ttl: 3600,
      }),
    );
    expect(result.ttl).toBe(3600);
  });

  it("omits ttl when absent", () => {
    const result = toApiRecord(
      rec({
        type: "A",
        name: "example.com",
        content: "192.0.2.1",
      }),
    );
    expect(result.ttl).toBeUndefined();
  });

  it("includes comment when present", () => {
    const result = toApiRecord(
      rec({
        type: "A",
        name: "example.com",
        content: "192.0.2.1",
        comment: "primary",
      }),
    );
    expect(result.comment).toBe("primary");
  });

  it("omits comment when absent", () => {
    const result = toApiRecord(
      rec({
        type: "A",
        name: "example.com",
        content: "192.0.2.1",
      }),
    );
    expect(result.comment).toBeUndefined();
  });
});

describe("toApiRecord — SVCB content parsing", () => {
  // SVCB/HTTPS content is parsed into structured data (priority, target, value)
  // for the Cloudflare API. Quoted values with spaces are a known parsing limitation.
  it("parses quoted values with spaces (known limitation: split by whitespace)", () => {
    const result = toApiRecord(
      rec({
        type: "SVCB",
        name: "_dns.resolver.example.com",
        content: '1 . alpn="h3 h2"',
      }),
    );
    expect(result.data?.value).toBe('alpn="h3 h2"');
  });
});

describe("RFC-0817: dns.record.upsert graceful skip", () => {
  it("returns skip result when dns-records.yaml is absent", async () => {
    const input = {
      argv: [],
      flags: { system: "test-system" },
    } as unknown as KernelCommandInput;

    const context = {
      workspaceRoot: "/test",
    } as unknown as KernelRuntimeContext;

    const result = await runDnsRecordUpsert(input, context);
    expect(result.data?.summary.total).toBe(0);
    expect(result.data?.results).toEqual([]);
    expect(result.summary).toContain("skipped");
    expect(result.summary).toContain("no dns-records.yaml");
  });
});
