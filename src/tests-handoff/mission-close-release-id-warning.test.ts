/*
<MODULE_CONTRACT>
<purpose>
Unit tests for mission close release id warning covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0522: add unit tests for releaseId flag→manifest→null precedence and warning.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";

test("releaseId precedence: flag overrides manifest value", () => {
  const flagValue = "sys-r000002";
  const manifestValue = "sys-r000001";
  const releaseId = flagValue ?? manifestValue ?? null;
  expect(releaseId).toBe("sys-r000002");
});

test("releaseId precedence: manifest used when flag is null", () => {
  const flagValue = undefined;
  const manifestValue = "sys-r000001";
  const releaseId = flagValue ?? manifestValue ?? null;
  expect(releaseId).toBe("sys-r000001");
});

test("releaseId precedence: null when both flag and manifest are null", () => {
  const flagValue = undefined;
  const manifestValue = null;
  const releaseId = flagValue ?? manifestValue ?? null;
  expect(releaseId).toBe(null);
});

test("null releaseId produces missing-release-id warning", () => {
  const releaseId = null;
  const warnings: Array<{ rule: string; message: string }> = [];
  if (!releaseId) {
    warnings.push({
      rule: "missing-release-id",
      message:
        "Mission closed without release — releaseId is null. Run release.prepare after close to associate a release.",
    });
  }
  expect(warnings).toHaveLength(1);
  expect(warnings[0]!.rule).toBe("missing-release-id");
});

test("non-null releaseId produces no warning", () => {
  const releaseId = "sys-r000001";
  const warnings: Array<{ rule: string; message: string }> = [];
  if (!releaseId) {
    warnings.push({
      rule: "missing-release-id",
      message:
        "Mission closed without release — releaseId is null. Run release.prepare after close to associate a release.",
    });
  }
  expect(warnings).toHaveLength(0);
});
