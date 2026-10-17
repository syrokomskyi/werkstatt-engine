/*
<MODULE_CONTRACT>
<purpose>
Unit tests for materialize covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
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
