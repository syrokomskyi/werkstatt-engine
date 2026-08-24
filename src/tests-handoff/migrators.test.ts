/*
<MODULE_CONTRACT>
<purpose>RFC-0479: tests for the RFC-id-keyed migrator registry — selection, ordering, and id parsing.</purpose>
<keywords>RFC-0479, migrator, registry, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP><entry key="tests">migratorsToApply filtering + numericRfcId parsing.</entry></MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial migrator-registry tests.</item>
  <item>RFC-0479: rewritten for new RFC-id-keyed registry.</item>
  <item>RFC-0481: updated counts for rfc-0481 migrator registration.</item>
  <item>RFC-0483: updated counts for rfc-0483 migrator registration.</item>
  <item>RFC-0488: updated counts for rfc-0488 migrator registration.</item>
  <item>RFC-0492: updated counts for rfc-0492 migrator registration.</item>
  <item>RFC-0495: updated counts for rfc-0495 migrator registration.</item>
  <item>RFC-0496: updated counts for rfc-0496 migrator registration.</item>
  <item>RFC-0497: updated counts for rfc-0497 migrator registration.</item>
  <item>RFC-0498: updated counts for rfc-0498 migrator registration.</item>
  <item>RFC-0500: updated counts for rfc-0500 migrator registration.</item>
  <item>RFC-0501: updated counts for rfc-0501 migrator registration.</item>
  <item>RFC-0502: updated counts for rfc-0502 migrator registration.</item>
  <item>RFC-0504: updated counts for rfc-0504 migrator registration.</item>
  <item>RFC-0505: updated counts for rfc-0505 migrator registration.</item>
  <item>RFC-0506: updated counts for rfc-0506 migrator registration.</item>
  <item>RFC-0508: updated counts for rfc-0508 migrator registration.</item>
  <item>RFC-0512: updated counts for rfc-0512 migrator registration.</item>
  <item>RFC-0514: updated counts for rfc-0514 migrator registration.</item>
  <item>RFC-0529: updated counts for rfc-0529 migrator registration.</item>
  <item>RFC-0548: updated counts for rfc-0548 migrator registration.</item>
  <item>RFC-0572: updated counts for rfc-0572 migrator registration.</item>
  <item>RFC-0757: updated counts for rfc-0757 migrator registration.</item>
  <item>RFC-0885: updated counts for rfc-0885 migrator registration.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import {
  migratorRegistry,
  migratorsToApply,
  numericRfcId,
  allMigratorIds,
} from "../migrators/registry.ts";

test("registry is seeded with rfc-0479 through rfc-0885 migrators", () => {
  expect(migratorRegistry.length).toBe(23);
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
  expect(chain.length).toBe(23);
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
  ]);
});
