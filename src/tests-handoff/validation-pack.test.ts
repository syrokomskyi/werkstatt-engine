/*
<MODULE_CONTRACT>
<purpose>RFC-0221: tests for the golden validation-pack diff — route/sitemap/llms/score drift.</purpose>
<keywords>RFC-0221, validation pack, diff, golden, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP><entry key="tests">diffValidationPacks clean + each drift dimension.</entry></MODULE_MAP>
<CHANGE_SUMMARY><item>RFC-0221: initial validation-pack diff tests.</item></CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { diffValidationPacks, type ValidationPack } from "../handoff/validation-pack.ts";

function pack(over: Partial<ValidationPack> = {}): ValidationPack {
  return {
    routes: ["index.html", "de/index.html"],
    sitemapHash: `sha256:${"a".repeat(64)}`,
    llmsHashes: { "llms.txt": `sha256:${"b".repeat(64)}` },
    scores: { nebula: 90, pillars: { performance: 88, accessibility: 95 } },
    empty: false,
    ...over,
  };
}

test("identical packs diff clean", () => {
  const d = diffValidationPacks(pack(), pack());
  expect(d.clean).toBe(true);
});

test("route add/remove is detected", () => {
  const d = diffValidationPacks(pack(), pack({ routes: ["index.html", "uk/index.html"] }));
  expect(d.routesRemoved).toEqual(["de/index.html"]);
  expect(d.routesAdded).toEqual(["uk/index.html"]);
  expect(d.clean).toBe(false);
});

test("sitemap and llms hash changes are detected", () => {
  const d = diffValidationPacks(
    pack(),
    pack({
      sitemapHash: `sha256:${"c".repeat(64)}`,
      llmsHashes: { "llms.txt": `sha256:${"d".repeat(64)}` },
    }),
  );
  expect(d.sitemapChanged).toBe(true);
  expect(d.llmsChanged).toEqual(["llms.txt"]);
  expect(d.clean).toBe(false);
});

test("score deltas are reported with from/to", () => {
  const d = diffValidationPacks(
    pack(),
    pack({ scores: { nebula: 84, pillars: { performance: 88, accessibility: 91 } } }),
  );
  expect(d.clean).toBe(false);
  expect(d.scoreDeltas.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
    { key: "nebula", from: 90, to: 84 },
    { key: "pillar.accessibility", from: 95, to: 91 },
  ]);
});

test("absent scores on both sides produce no score deltas", () => {
  const d = diffValidationPacks(pack({ scores: null }), pack({ scores: null }));
  expect(d.scoreDeltas.length).toBe(0);
  expect(d.clean).toBe(true);
});
