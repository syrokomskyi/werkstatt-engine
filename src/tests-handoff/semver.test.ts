/*
<MODULE_CONTRACT>
<purpose>RFC-0221: tests for the x.y.z semver comparison and range membership.</purpose>
<keywords>RFC-0221, semver, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP><entry key="tests">compareSemver ordering + inOpenClosedRange bounds.</entry></MODULE_MAP>
<CHANGE_SUMMARY><item>RFC-0221: initial semver tests.</item></CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { compareSemver, inOpenClosedRange, parseSemver } from "../handoff/semver.ts";

test("compareSemver: orders by major, minor, patch", () => {
  expect(compareSemver("4.5.0", "4.5.0")).toBe(0);
  expect(compareSemver("4.5.0", "4.6.0")).toBe(-1);
  expect(compareSemver("4.6.0", "4.5.0")).toBe(1);
  expect(compareSemver("4.5.1", "4.5.0")).toBe(1);
  expect(compareSemver("5.0.0", "4.99.99")).toBe(1);
});

test("parseSemver: rejects non x.y.z", () => {
  expect(() => parseSemver("4.5")).toThrow();
  expect(() => parseSemver("v4.5.0")).toThrow();
});

test("inOpenClosedRange: (from, to] is exclusive at from, inclusive at to", () => {
  expect(inOpenClosedRange("4.5.0", "4.5.0", "4.7.0")).toBe(false); // == from excluded
  expect(inOpenClosedRange("4.6.0", "4.5.0", "4.7.0")).toBe(true);
  expect(inOpenClosedRange("4.7.0", "4.5.0", "4.7.0")).toBe(true); // == to included
  expect(inOpenClosedRange("4.8.0", "4.5.0", "4.7.0")).toBe(false);
});
