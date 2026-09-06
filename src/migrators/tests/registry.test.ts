/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: test migrator registry — ordering, cursor filtering, idempotency of selection.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial registry test.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { migratorRegistry, numericRfcId, migratorsToApply, allMigratorIds } from "../registry.ts";

test("registry is non-empty and sorted by numeric RFC id", () => {
  expect(migratorRegistry.length).toBeGreaterThan(0);
  const ids = migratorRegistry.map((m) => m.id);
  const sorted = [...ids].sort((a, b) => numericRfcId(a) - numericRfcId(b));
  expect(ids).toEqual(sorted);
});

test("numericRfcId extracts numeric part from rfc-XXXX", () => {
  expect(numericRfcId("rfc-0479")).toBe(479);
  expect(numericRfcId("rfc-0885")).toBe(885);
  expect(numericRfcId("invalid")).toBe(0);
});

test("migratorsToApply returns migrators not in cursor, sorted by id", () => {
  const all = allMigratorIds();
  const cursor = all.slice(0, 3);
  const toApply = migratorsToApply(cursor);
  expect(toApply.length).toBe(all.length - 3);
  for (const m of toApply) {
    expect(cursor).not.toContain(m.id);
  }
  const ids = toApply.map((m) => m.id);
  const sorted = [...ids].sort((a, b) => numericRfcId(a) - numericRfcId(b));
  expect(ids).toEqual(sorted);
});

test("migratorsToApply with empty cursor returns all migrators", () => {
  const toApply = migratorsToApply([]);
  expect(toApply.length).toBe(migratorRegistry.length);
});

test("migratorsToApply with full cursor returns empty array", () => {
  const cursor = allMigratorIds();
  const toApply = migratorsToApply(cursor);
  expect(toApply).toEqual([]);
});

test("allMigratorIds returns sorted unique ids", () => {
  const ids = allMigratorIds();
  const sorted = [...ids].sort((a, b) => numericRfcId(a) - numericRfcId(b));
  expect(ids).toEqual(sorted);
  const unique = new Set(ids);
  expect(unique.size).toBe(ids.length);
});
