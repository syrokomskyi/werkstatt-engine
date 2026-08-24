/*
<MODULE_CONTRACT>
<purpose>RFC-0221/RFC-0479: tests for the materialization pure core — bundle→app path mapping.
Migrator chain application tests moved to migrators.test.ts (RFC-0479).</purpose>
<keywords>RFC-0221, materialize, path mapping, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP><entry key="tests">toAppRelative path mapping.</entry></MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial materialization tests.</item>
  <item>RFC-0479: removed applyMigratorChain tests — migrated to migrators.test.ts.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { toAppRelative } from "../handoff/materialize.ts";

test("toAppRelative strips the site/ prefix and rejects non-site paths", () => {
  expect(toAppRelative("site/src/content/business-profile/de/business.md")).toBe(
    "src/content/business-profile/de/business.md",
  );
  expect(toAppRelative("site\\public\\logo.svg")).toBe("public/logo.svg");
  expect(toAppRelative("handoff-lock.json")).toBe(null);
});
