/*
<MODULE_CONTRACT>
  <purpose>RFC-0588: unit tests for isRouteRedirected and collectRoutes redirect exclusion logic.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0588: initial behavior snapshot redirect exclusion tests.</item>
  <item>RFC-0592: update wildcard matching test for /de directory root (now matches /de/*).</item>
  <item>RFC-0595: add redirect page detection tests (contentHash: null + redirectTarget).</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { isRouteRedirected, collectRoutes } from "./behavior-snapshot-commands.ts";
import {
  parseRedirectRules,
  extractRedirectTarget,
  type RedirectRule,
} from "@warpgogol/werkstatt-shared/share/redirects";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "bsnap-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("isRouteRedirected: /de/* wildcard matches /de, /de/agb, /de/agb/terms, /de/", () => {
  const rules = parseRedirectRules("/de/* / 308");
  expect(isRouteRedirected("/de", rules)).toBe(true);
  expect(isRouteRedirected("/de/agb", rules)).toBe(true);
  expect(isRouteRedirected("/de/agb/terms", rules)).toBe(true);
  expect(isRouteRedirected("/agb", rules)).toBe(false);
});

test("isRouteRedirected: literal path /old-page matches exactly, not sub-paths", () => {
  const rules = parseRedirectRules("/old-page /new-page 301");
  expect(isRouteRedirected("/old-page", rules)).toBe(true);
  expect(isRouteRedirected("/old-page/sub", rules)).toBe(false);
});

test("isRouteRedirected: 410 status rules are NOT excluded", () => {
  const rules = parseRedirectRules("/gone / 410");
  expect(isRouteRedirected("/gone", rules)).toBe(false);
});

test("isRouteRedirected: empty rules array returns false for any route", () => {
  expect(isRouteRedirected("/anything", [])).toBe(false);
});

test("isRouteRedirected: 301 status rules are excluded", () => {
  const rules = parseRedirectRules("/old /new 301");
  expect(isRouteRedirected("/old", rules)).toBe(true);
});

test("isRouteRedirected: 308 status rules are excluded", () => {
  const rules = parseRedirectRules("/old /new 308");
  expect(isRouteRedirected("/old", rules)).toBe(true);
});

test("collectRoutes: excludes redirected routes from snapshot", async () => {
  mkdirSync(path.join(tmpDir, "agb"), { recursive: true });
  mkdirSync(path.join(tmpDir, "de", "agb"), { recursive: true });
  await fs.writeFile(path.join(tmpDir, "index.html"), "<html>home</html>");
  await fs.writeFile(path.join(tmpDir, "agb", "index.html"), "<html>agb</html>");
  await fs.writeFile(path.join(tmpDir, "de", "agb", "index.html"), "<html>de-agb</html>");

  const rules: RedirectRule[] = parseRedirectRules("/de/* / 308");
  const routes = await collectRoutes(tmpDir, rules);

  const paths = routes.map((r) => r.path);
  expect(paths).toContain("/");
  expect(paths).toContain("/agb");
  expect(paths).not.toContain("/de/agb");
});

test("collectRoutes: without redirect rules, all routes included", async () => {
  mkdirSync(path.join(tmpDir, "agb"), { recursive: true });
  mkdirSync(path.join(tmpDir, "de", "agb"), { recursive: true });
  await fs.writeFile(path.join(tmpDir, "index.html"), "<html>home</html>");
  await fs.writeFile(path.join(tmpDir, "agb", "index.html"), "<html>agb</html>");
  await fs.writeFile(path.join(tmpDir, "de", "agb", "index.html"), "<html>de-agb</html>");

  const routes = await collectRoutes(tmpDir);

  const paths = routes.map((r) => r.path);
  expect(paths).toContain("/");
  expect(paths).toContain("/agb");
  expect(paths).toContain("/de/agb");
});

test("parseRedirectRules: import from @warpgogol/werkstatt-shared/share/redirects works correctly", () => {
  const rules = parseRedirectRules("/old /new 301\n# comment\n/de/* / 308\n");
  expect(rules).toHaveLength(2);
  expect(rules[0].from).toBe("/old");
  expect(rules[0].to).toBe("/new");
  expect(rules[0].status).toBe(301);
  expect(rules[1].from).toBe("/de/*");
  expect(rules[1].status).toBe(308);
});

test("collectRoutes: redirect pages get contentHash: null + redirectTarget", async () => {
  mkdirSync(path.join(tmpDir, "de"), { recursive: true });
  const normalHtml = "<html><head><title>Home</title></head><body>content</body></html>";
  const redirectHtml =
    '<html><head><meta http-equiv="refresh" content="0;url=/"></head><body></body></html>';
  await fs.writeFile(path.join(tmpDir, "index.html"), normalHtml);
  await fs.writeFile(path.join(tmpDir, "de", "index.html"), redirectHtml);

  const routes = await collectRoutes(tmpDir);

  const homeRoute = routes.find((r) => r.path === "/");
  expect(homeRoute).toBeDefined();
  expect(homeRoute!.contentHash).not.toBeNull();
  expect(homeRoute!.redirectTarget).toBeUndefined();

  const deRoute = routes.find((r) => r.path === "/de");
  expect(deRoute).toBeDefined();
  expect(deRoute!.contentHash).toBeNull();
  expect(deRoute!.redirectTarget).toBe("/");
});

test("collectRoutes: redirect page with unparseable target gets 'unknown'", async () => {
  mkdirSync(path.join(tmpDir, "weird"), { recursive: true });
  const redirectHtml =
    '<html><head><meta http-equiv="refresh" content="0"></head><body></body></html>';
  await fs.writeFile(path.join(tmpDir, "weird", "index.html"), redirectHtml);

  const routes = await collectRoutes(tmpDir);
  const weirdRoute = routes.find((r) => r.path === "/weird");
  expect(weirdRoute).toBeDefined();
  expect(weirdRoute!.contentHash).toBeNull();
  expect(weirdRoute!.redirectTarget).toBe("unknown");
});

test("collectRoutes: non-redirect routes retain contentHash as string", async () => {
  await fs.writeFile(path.join(tmpDir, "index.html"), "<html>home</html>");
  const routes = await collectRoutes(tmpDir);
  expect(routes).toHaveLength(1);
  expect(routes[0].contentHash).not.toBeNull();
  expect(typeof routes[0].contentHash).toBe("string");
});

test("extractRedirectTarget: import from @warpgogol/werkstatt-shared/share/redirects works in handoff tests", () => {
  const html = '<meta http-equiv="refresh" content="0;url=/target">';
  expect(extractRedirectTarget(html)).toBe("/target");
});
