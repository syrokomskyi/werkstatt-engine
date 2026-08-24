/*
<MODULE_CONTRACT>
  <purpose>RFC-0595: unit tests for verifyRedirectRoute and extractRedirectTarget multi-hop.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0595: initial verifyRedirectRoute and multi-hop tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { verifyRedirectRoute } from "./cloudflare-workers.ts";
import type { RouteFact } from "@warpgogol/werkstatt-engine/schemas";

test("verifyRedirectRoute: 307 with matching Location passes", () => {
  const route: RouteFact = { path: "/de", contentHash: null, redirectTarget: "/" };
  const result = verifyRedirectRoute(307, "/", route);
  expect(result.passed).toBe(true);
  expect(result.detail).toBe("Redirect 307 → /");
});

test("verifyRedirectRoute: 308 with matching Location passes", () => {
  const route: RouteFact = { path: "/old", contentHash: null, redirectTarget: "/new" };
  const result = verifyRedirectRoute(308, "/new", route);
  expect(result.passed).toBe(true);
});

test("verifyRedirectRoute: 200 fails (expected redirect status)", () => {
  const route: RouteFact = { path: "/de", contentHash: null, redirectTarget: "/" };
  const result = verifyRedirectRoute(200, "", route);
  expect(result.passed).toBe(false);
  expect(result.detail).toBe("Expected redirect status (307/308), got 200");
});

test("verifyRedirectRoute: 307 with mismatched Location fails", () => {
  const route: RouteFact = { path: "/de", contentHash: null, redirectTarget: "/" };
  const result = verifyRedirectRoute(307, "/en", route);
  expect(result.passed).toBe(false);
  expect(result.detail).toContain("Location mismatch");
  expect(result.detail).toContain("got /en");
  expect(result.detail).toContain("expected /");
});

test("verifyRedirectRoute: 307 with unknown target passes (status-only check)", () => {
  const route: RouteFact = { path: "/de", contentHash: null, redirectTarget: "unknown" };
  const result = verifyRedirectRoute(307, "/anywhere", route);
  expect(result.passed).toBe(true);
});

test("verifyRedirectRoute: 307 with no redirectTarget passes (status-only check)", () => {
  const route: RouteFact = { path: "/de", contentHash: null };
  const result = verifyRedirectRoute(308, "/somewhere", route);
  expect(result.passed).toBe(true);
});

test("verifyRedirectRoute: 404 fails (not a redirect status)", () => {
  const route: RouteFact = { path: "/de", contentHash: null, redirectTarget: "/" };
  const result = verifyRedirectRoute(404, "", route);
  expect(result.passed).toBe(false);
  expect(result.detail).toBe("Expected redirect status (307/308), got 404");
});

test("verifyRedirectRoute: 301 fails (only 307/308 accepted, not 301)", () => {
  const route: RouteFact = { path: "/de", contentHash: null, redirectTarget: "/" };
  const result = verifyRedirectRoute(301, "/", route);
  expect(result.passed).toBe(false);
  expect(result.detail).toBe("Expected redirect status (307/308), got 301");
});
