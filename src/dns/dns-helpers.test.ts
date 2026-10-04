/*
<MODULE_CONTRACT>
  <purpose>RFC-0753: unit tests for DNS helpers — recordsMatch, resolveZoneDomainForSystem, flagString, flagBoolean.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial DNS helper tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import type { DnsRecordDeclaration } from "@warpgogol/werkstatt-shared/ontology/schemas";
import {
  flagString,
  flagBoolean,
  pickBestLiveMatch,
  recordsMatch,
  resolveZoneDomainForSystem,
} from "./dns-helpers.ts";

test("flagString: returns string value", () => {
  expect(flagString({ flags: { system: "warpgogol-com" } }, "system")).toBe("warpgogol-com");
});

test("flagString: returns undefined for non-string", () => {
  expect(flagString({ flags: { system: 42 } }, "system")).toBeUndefined();
});

test("flagString: returns undefined for missing key", () => {
  expect(flagString({ flags: {} }, "system")).toBeUndefined();
});

test("flagBoolean: returns boolean value", () => {
  expect(flagBoolean({ flags: { "dry-run": true } }, "dry-run")).toBe(true);
});

test("flagBoolean: returns undefined for non-boolean", () => {
  expect(flagBoolean({ flags: { "dry-run": "yes" } }, "dry-run")).toBeUndefined();
});

test("recordsMatch: matching A record", () => {
  expect(
    recordsMatch(
      { name: "warpgogol.com", type: "A", content: "192.0.2.1", proxied: true },
      { type: "A", name: "warpgogol.com", content: "192.0.2.1", proxied: true, priority: null },
    ),
  ).toBe(true);
});

test("recordsMatch: mismatched content", () => {
  expect(
    recordsMatch(
      { name: "warpgogol.com", type: "A", content: "192.0.2.1", proxied: true },
      { type: "A", name: "warpgogol.com", content: "192.0.2.2", proxied: true, priority: null },
    ),
  ).toBe(false);
});

test("recordsMatch: mismatched proxied", () => {
  expect(
    recordsMatch(
      { name: "warpgogol.com", type: "A", content: "192.0.2.1", proxied: true },
      { type: "A", name: "warpgogol.com", content: "192.0.2.1", proxied: false, priority: null },
    ),
  ).toBe(false);
});

test("recordsMatch: default proxied=false when declared has no proxied", () => {
  expect(
    recordsMatch(
      { name: "_dmarc", type: "TXT", content: "v=DMARC1; p=quarantine", proxied: false },
      {
        type: "TXT",
        name: "_dmarc",
        content: "v=DMARC1; p=quarantine",
        proxied: false,
        priority: null,
      },
    ),
  ).toBe(true);
});

test("recordsMatch: TXT content normalized for comparison", () => {
  expect(
    recordsMatch(
      { name: "warpgogol.com", type: "TXT", content: "v=spf1 include:_spf ~all", proxied: false },
      {
        type: "TXT",
        name: "warpgogol.com",
        content: '"v=spf1  include:_spf   ~all"',
        proxied: false,
        priority: null,
      },
    ),
  ).toBe(true);
});

test("recordsMatch: SVCB tolerates Cloudflare presentation normalization", () => {
  expect(
    recordsMatch(
      {
        name: "_index._agents.warpgogol.com",
        type: "SVCB",
        content: "1 warpgogol.com alpn=h2 port=443",
        proxied: false,
      },
      {
        type: "SVCB",
        name: "_index._agents.warpgogol.com",
        content: '1 warpgogol.com. alpn="h2" port="443"',
        proxied: false,
        priority: null,
      },
    ),
  ).toBe(true);
});

test("recordsMatch: live HTTPS satisfies declared SVCB", () => {
  expect(
    recordsMatch(
      {
        name: "_mcp._agents.warpgogol.com",
        type: "SVCB",
        content: "1 mcp.warpgogol.com alpn=h2 port=443",
        proxied: false,
      },
      {
        type: "HTTPS",
        name: "_mcp._agents.warpgogol.com",
        content: '1 mcp.warpgogol.com. alpn="h2" port="443" ipv4hint="104.21.0.1"',
        proxied: false,
        priority: null,
      },
    ),
  ).toBe(true);
});

test("recordsMatch: SVCB mismatched declared param value", () => {
  expect(
    recordsMatch(
      {
        name: "_index._agents.warpgogol.com",
        type: "SVCB",
        content: "1 warpgogol.com alpn=h2 port=443",
        proxied: false,
      },
      {
        type: "SVCB",
        name: "_index._agents.warpgogol.com",
        content: '1 warpgogol.com. alpn="h3" port="443"',
        proxied: false,
        priority: null,
      },
    ),
  ).toBe(false);
});

test("recordsMatch: SVCB missing declared param in live", () => {
  expect(
    recordsMatch(
      {
        name: "_index._agents.warpgogol.com",
        type: "SVCB",
        content: "1 warpgogol.com alpn=h2 port=443",
        proxied: false,
      },
      {
        type: "SVCB",
        name: "_index._agents.warpgogol.com",
        content: '1 warpgogol.com. alpn="h2"',
        proxied: false,
        priority: null,
      },
    ),
  ).toBe(false);
});

test("recordsMatch: SVCB mismatched target", () => {
  expect(
    recordsMatch(
      {
        name: "_index._agents.warpgogol.com",
        type: "SVCB",
        content: "1 warpgogol.com alpn=h2 port=443",
        proxied: false,
      },
      {
        type: "SVCB",
        name: "_index._agents.warpgogol.com",
        content: '1 other.example.com. alpn="h2" port="443"',
        proxied: false,
        priority: null,
      },
    ),
  ).toBe(false);
});

test("recordsMatch: MX with matching priority", () => {
  expect(
    recordsMatch(
      {
        name: "warpgogol.com",
        type: "MX",
        content: "mail.warpgogol.com",
        priority: 10,
        proxied: false,
      },
      {
        type: "MX",
        name: "warpgogol.com",
        content: "mail.warpgogol.com",
        proxied: false,
        priority: 10,
      },
    ),
  ).toBe(true);
});

test("recordsMatch: MX with mismatched priority", () => {
  expect(
    recordsMatch(
      {
        name: "warpgogol.com",
        type: "MX",
        content: "mail.warpgogol.com",
        priority: 10,
        proxied: false,
      },
      {
        type: "MX",
        name: "warpgogol.com",
        content: "mail.warpgogol.com",
        proxied: false,
        priority: 20,
      },
    ),
  ).toBe(false);
});

test("recordsMatch: mismatched type", () => {
  expect(
    recordsMatch(
      { name: "warpgogol.com", type: "A", content: "192.0.2.1", proxied: true },
      { type: "AAAA", name: "warpgogol.com", content: "192.0.2.1", proxied: true, priority: null },
    ),
  ).toBe(false);
});

const liveMx = (id: string, content: string, priority: number) => ({
  id,
  type: "MX",
  name: "warpgogol.com",
  content,
  proxied: false,
  priority,
});

test("pickBestLiveMatch: duplicate type+name picks the fully matching live record", () => {
  const live = [
    liveMx("r3", "route3.mx.cloudflare.net", 17),
    liveMx("r2", "route2.mx.cloudflare.net", 67),
    liveMx("r1", "route1.mx.cloudflare.net", 92),
  ];
  const declared: DnsRecordDeclaration = {
    name: "warpgogol.com",
    type: "MX",
    content: "route1.mx.cloudflare.net",
    priority: 92,
    proxied: false,
  };
  expect(pickBestLiveMatch(declared, live, new Set())?.id).toBe("r1");
});

test("pickBestLiveMatch: consumed live records are skipped; fallback is first candidate", () => {
  const live = [
    liveMx("r3", "route3.mx.cloudflare.net", 17),
    liveMx("r1", "route1.mx.cloudflare.net", 92),
  ];
  const declared: DnsRecordDeclaration = {
    name: "warpgogol.com",
    type: "MX",
    content: "route1.mx.cloudflare.net",
    priority: 92,
    proxied: false,
  };
  // r1 already consumed by an earlier declaration — the declaration can no
  // longer match it, so the fallback returns the first remaining candidate.
  expect(pickBestLiveMatch(declared, live, new Set(["r1"]))?.id).toBe("r3");
  // Nothing left to consume → missing semantics for the caller.
  expect(pickBestLiveMatch(declared, live, new Set(["r1", "r3"]))).toBeUndefined();
});

test("resolveZoneDomainForSystem: extracts hostname from main URL", () => {
  const systems = [
    {
      id: "warpgogol-com",
      deployment: { channels: { main: { url: "https://warpgogol.com" } } },
    },
  ];
  expect(resolveZoneDomainForSystem(systems, "warpgogol-com")).toBe("warpgogol.com");
});

test("resolveZoneDomainForSystem: throws for unknown system", () => {
  expect(() => resolveZoneDomainForSystem([], "unknown")).toThrow("Could not resolve zone domain");
});
