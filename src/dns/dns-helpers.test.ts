/*
<MODULE_CONTRACT>
  <purpose>RFC-0753: unit tests for DNS helpers — recordsMatch, resolveZoneDomainForSystem, flagString, flagBoolean.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial DNS helper tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import {
  flagString,
  flagBoolean,
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
