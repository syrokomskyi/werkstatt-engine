/*
<MODULE_CONTRACT>
<purpose>RFC-0497: no-op migrator — intersection records are a new content collection
with no prior authored content to transform. This migrator exists solely to advance
the migratorCursor so that systems absorbing a post-RFC-0497 platform version record
the migration as applied. It performs no file transforms.</purpose>
<non-goals>
  <item>Do not transform any authored content — intersection records are a new collection.</item>
  <item>Do not delete or rename any files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0497: initial no-op migrator — advances migratorCursor without file transforms.</item>
</CHANGE_SUMMARY>
*/

import type { Migrator } from "./types.ts";

export const RFC_0497_MIGRATOR_ID = "rfc-0497";

export const rfc0497Migrator: Migrator = {
  id: RFC_0497_MIGRATOR_ID,
  fromVersion: "4.10.0",
  toVersion: "4.11.0",
  description:
    "No-op migrator — intersection records are a new content collection with no prior authored content to transform. Advances migratorCursor for RFC-0497 (explicit intersection records for depth-5 city×service pages).",
  transform: async (data) => {
    return data;
  },
};
