/*
<MODULE_CONTRACT>
<purpose>
Unit tests for authored set covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: cover generator public outputs missed by marker detection.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { isGeneratedPublicArtifact } from "../handoff/authored-set.ts";

test("matches build.prepare public generator outputs", () => {
  for (const p of [
    "public/sitemap.xml",
    "public/sitemap-images.xml",
    "public/robots.txt",
    "public/feed.xml",
    "public/rss.xml",
    "public/llms.txt",
    "public/llms-full.txt",
    "public/ai.txt",
    "public/.well-known/pseo-manifest.json",
    "public/pseo-star-map.svg",
  ]) {
    expect(isGeneratedPublicArtifact(p)).toBe(true);
  }
});

test("does not match authored public assets or non-public paths", () => {
  for (const p of [
    "public/favicon.ico",
    "public/logo.svg",
    "public/.well-known/cosmic-passport-key.json",
    "public/.assetsignore",
    "src/content/business-profile/de/business.md",
    "feed.xml",
  ]) {
    expect(isGeneratedPublicArtifact(p)).toBe(false);
  }
});
