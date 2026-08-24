/*
<MODULE_CONTRACT>
<purpose>RFC-0506: no-op migrator — ratgeber article JSON-LD Article fields, BreadcrumbList,
and FAQPage prohibition is a C-contract change, not a data contract change. This migrator
exists solely to advance the migratorCursor so that systems absorbing a post-RFC-0506
platform version record the migration as applied. It performs no file transforms.</purpose>
<non-goals>
  <item>Do not transform any authored content — the policy is enforced at build time via C-contract validation and renderer changes.</item>
  <item>Do not delete or rename any files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0506: initial no-op migrator — advances migratorCursor without file transforms.</item>
</CHANGE_SUMMARY>
*/

import type { Migrator } from "./types.ts";

export const RFC_0506_MIGRATOR_ID = "rfc-0506";

export const rfc0506Migrator: Migrator = {
  id: RFC_0506_MIGRATOR_ID,
  fromVersion: "4.16.0",
  toVersion: "4.17.0",
  description:
    "No-op migrator — ratgeber article JSON-LD Article fields, BreadcrumbList, and FAQPage prohibition is a C-contract change, not a data contract change. Advances migratorCursor for RFC-0506.",
  transform: async (data) => {
    return data;
  },
};
