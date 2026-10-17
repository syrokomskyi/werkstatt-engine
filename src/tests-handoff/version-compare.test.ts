/*
<MODULE_CONTRACT>
<purpose>RFC-0221 §4.1: tests for the version-compare matrix — the downgrade-refusal gate
and the packages-drift flag.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial matrix tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { compareEcosystem } from "../handoff/version-compare.ts";

const H_A = `sha256:${"a".repeat(64)}`;
const H_B = `sha256:${"b".repeat(64)}`;

test("refuse-downgrade when bundle is newer than recipient", () => {
  const r = compareEcosystem({
    sourceVersion: "4.7.0",
    currentVersion: "4.5.0",
    sourcePackagesHash: H_A,
    currentPackagesHash: H_B,
  });
  expect(r.verdict).toBe("refuse-downgrade");
  expect(r.message).toMatch(/git pull/);
});

test("catch-up when bundle is older than recipient", () => {
  const r = compareEcosystem({
    sourceVersion: "4.2.0",
    currentVersion: "4.5.0",
    sourcePackagesHash: H_A,
    currentPackagesHash: H_A,
  });
  expect(r.verdict).toBe("catch-up");
});

test("in-sync with no drift when versions and hashes match", () => {
  const r = compareEcosystem({
    sourceVersion: "4.5.0",
    currentVersion: "4.5.0",
    sourcePackagesHash: H_A,
    currentPackagesHash: H_A,
  });
  expect(r.verdict).toBe("in-sync");
  expect(r.packagesDrift).toBe(false);
});

test("in-sync flags packages drift when hashes differ at equal versions", () => {
  const r = compareEcosystem({
    sourceVersion: "4.5.0",
    currentVersion: "4.5.0",
    sourcePackagesHash: H_A,
    currentPackagesHash: H_B,
  });
  expect(r.verdict).toBe("in-sync");
  expect(r.packagesDrift).toBe(true);
});

test("RFC-0364: platformSemanticHash preferred over legacy packagesHash", () => {
  const r = compareEcosystem({
    sourceVersion: "4.5.0",
    currentVersion: "4.5.0",
    sourcePackagesHash: H_A,
    currentPackagesHash: H_B,
    sourcePlatformSemanticHash: H_A,
    currentPlatformSemanticHash: H_A,
  });
  expect(r.verdict).toBe("in-sync");
  expect(r.packagesDrift).toBe(false);
});
