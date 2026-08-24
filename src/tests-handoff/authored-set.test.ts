/*
<MODULE_CONTRACT>
<purpose>RFC-0221: tests for the Compass-complete partition's generated-public-artifact matcher
(sitemap/robots/feed/llms/ai/pseo outputs that lack the RFC-0081 marker).</purpose>
<keywords>RFC-0221, authored partition, generated public, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP><entry key="tests">isGeneratedPublicArtifact include/exclude cases.</entry></MODULE_MAP>
<CHANGE_SUMMARY><item>RFC-0221: cover generator public outputs missed by marker detection.</item></CHANGE_SUMMARY>
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
