import { test, expect } from "vitest";
import { bootSmokeAppliesToAdapter } from "../release/release-commands.ts";

test("boot-smoke runs for worker-runtime deployments", () => {
  expect(bootSmokeAppliesToAdapter("cloudflare-workers")).toBe(true);
});

test("boot-smoke is skipped for static adapters (github-pages)", () => {
  // Regression: github-pages workpieces carry a generated wrangler.jsonc but
  // emit no worker bundle — boot-smoke failed with "Worker entry point not
  // found" on the first forge-site release.
  expect(bootSmokeAppliesToAdapter("github-pages")).toBe(false);
});

test("boot-smoke is skipped for no-runtime adapters", () => {
  expect(bootSmokeAppliesToAdapter("null")).toBe(false);
  expect(bootSmokeAppliesToAdapter(null)).toBe(false);
  expect(bootSmokeAppliesToAdapter(undefined)).toBe(false);
});

test("unknown adapters keep boot-smoke enabled (strict default)", () => {
  expect(bootSmokeAppliesToAdapter("local-render")).toBe(true);
});
