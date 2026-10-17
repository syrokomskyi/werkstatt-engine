/*
<MODULE_CONTRACT>
<purpose>
Unit tests for migrators covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0529: updated counts for rfc-0529 migrator registration.</item>
  <item>RFC-0548: updated counts for rfc-0548 migrator registration.</item>
  <item>RFC-0572: updated counts for rfc-0572 migrator registration.</item>
  <item>RFC-0757: updated counts for rfc-0757 migrator registration.</item>
  <item>RFC-0885: updated counts for rfc-0885 migrator registration.</item>
  <history>RFC-0221, RFC-0479, RFC-0481, RFC-0483, RFC-0488, RFC-0492, RFC-0495, RFC-0496, RFC-0497, RFC-0498, RFC-0500, RFC-0501, RFC-0502, RFC-0504, RFC-0505, RFC-0506, RFC-0508, RFC-0512, RFC-0514</history>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import {
  migratorRegistry,
  migratorsToApply,
  numericRfcId,
  allMigratorIds,
} from "../migrators/registry.ts";

test("registry is seeded with rfc-0479 through rfc-1105 migrators", () => {
  expect(migratorRegistry.length).toBe(24);
  expect(migratorRegistry[0].id).toBe("rfc-0479");
  expect(migratorRegistry[1].id).toBe("rfc-0481");
  expect(migratorRegistry[2].id).toBe("rfc-0483");
  expect(migratorRegistry[3].id).toBe("rfc-0488");
  expect(migratorRegistry[4].id).toBe("rfc-0492");
  expect(migratorRegistry[5].id).toBe("rfc-0495");
  expect(migratorRegistry[6].id).toBe("rfc-0496");
  expect(migratorRegistry[7].id).toBe("rfc-0497");
  expect(migratorRegistry[8].id).toBe("rfc-0498");
  expect(migratorRegistry[9].id).toBe("rfc-0500");
  expect(migratorRegistry[10].id).toBe("rfc-0501");
  expect(migratorRegistry[11].id).toBe("rfc-0502");
  expect(migratorRegistry[12].id).toBe("rfc-0504");
  expect(migratorRegistry[13].id).toBe("rfc-0505");
  expect(migratorRegistry[14].id).toBe("rfc-0506");
  expect(migratorRegistry[15].id).toBe("rfc-0508");
  expect(migratorRegistry[16].id).toBe("rfc-0512");
  expect(migratorRegistry[17].id).toBe("rfc-0514");
  expect(migratorRegistry[18].id).toBe("rfc-0529");
  expect(migratorRegistry[19].id).toBe("rfc-0548");
  expect(migratorRegistry[20].id).toBe("rfc-0572");
  expect(migratorRegistry[21].id).toBe("rfc-0757");
  expect(migratorRegistry[22].id).toBe("rfc-0885");
});

test("numericRfcId parses RFC-NNNN format", () => {
  expect(numericRfcId("rfc-0479")).toBe(479);
  expect(numericRfcId("RFC-9999")).toBe(9999);
  expect(numericRfcId("invalid")).toBe(0);
});

test("migratorsToApply returns migrators not in cursor", () => {
  const chain = migratorsToApply([]);
  expect(chain.length).toBe(24);
  expect(chain[0].id).toBe("rfc-0479");
  expect(chain[1].id).toBe("rfc-0481");
  expect(chain[2].id).toBe("rfc-0483");
  expect(chain[3].id).toBe("rfc-0488");
  expect(chain[4].id).toBe("rfc-0492");
  expect(chain[5].id).toBe("rfc-0495");
  expect(chain[6].id).toBe("rfc-0496");
  expect(chain[7].id).toBe("rfc-0497");
  expect(chain[8].id).toBe("rfc-0498");
  expect(chain[9].id).toBe("rfc-0500");
  expect(chain[10].id).toBe("rfc-0501");
  expect(chain[11].id).toBe("rfc-0502");
  expect(chain[12].id).toBe("rfc-0504");
  expect(chain[13].id).toBe("rfc-0505");
  expect(chain[14].id).toBe("rfc-0506");
  expect(chain[15].id).toBe("rfc-0508");
  expect(chain[16].id).toBe("rfc-0512");
  expect(chain[17].id).toBe("rfc-0514");
  expect(chain[18].id).toBe("rfc-0529");
  expect(chain[19].id).toBe("rfc-0548");
  expect(chain[20].id).toBe("rfc-0572");
  expect(chain[21].id).toBe("rfc-0757");
  expect(chain[22].id).toBe("rfc-0885");
  expect(chain[23].id).toBe("rfc-1105");
});

test("migratorsToApply excludes already-applied migrators", () => {
  const chain = migratorsToApply([
    "rfc-0479",
    "rfc-0481",
    "rfc-0483",
    "rfc-0488",
    "rfc-0492",
    "rfc-0495",
    "rfc-0496",
    "rfc-0497",
    "rfc-0498",
    "rfc-0500",
    "rfc-0501",
    "rfc-0502",
    "rfc-0504",
    "rfc-0505",
    "rfc-0506",
    "rfc-0508",
    "rfc-0512",
    "rfc-0514",
    "rfc-0529",
    "rfc-0548",
    "rfc-0572",
    "rfc-0757",
    "rfc-0885",
    "rfc-1105",
  ]);
  expect(chain.length).toBe(0);
});

test("allMigratorIds returns sorted ids", () => {
  const ids = allMigratorIds();
  expect(ids).toEqual([
    "rfc-0479",
    "rfc-0481",
    "rfc-0483",
    "rfc-0488",
    "rfc-0492",
    "rfc-0495",
    "rfc-0496",
    "rfc-0497",
    "rfc-0498",
    "rfc-0500",
    "rfc-0501",
    "rfc-0502",
    "rfc-0504",
    "rfc-0505",
    "rfc-0506",
    "rfc-0508",
    "rfc-0512",
    "rfc-0514",
    "rfc-0529",
    "rfc-0548",
    "rfc-0572",
    "rfc-0757",
    "rfc-0885",
    "rfc-1105",
  ]);
});
