/*
<MODULE_CONTRACT>
<purpose>RFC-0495: no-op migrator — URL slugs are derived from blueprint + geo
axis data, not authored content. This migrator exists solely to advance the
migratorCursor so that systems absorbing a post-RFC-0495 platform version
record the migration as applied. It performs no file transforms.</purpose>
<non-goals>
  <item>Do not transform any authored content — URL slugs are generated from blueprint templates.</item>
  <item>Do not delete or rename any files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0495: initial no-op migrator — advances migratorCursor without file transforms.</item>
</CHANGE_SUMMARY>
*/

import type { Migrator } from "./types.ts";

export const RFC_0495_MIGRATOR_ID = "rfc-0495";

export const rfc0495Migrator: Migrator = {
  id: RFC_0495_MIGRATOR_ID,
  fromVersion: "4.8.0",
  toVersion: "4.9.0",
  description:
    "No-op migrator — URL slugs are derived from blueprint + geo axis data, not authored content. Advances migratorCursor for RFC-0495 (remove country/region segments from depth-4/depth-5 canonical URLs).",
  transform: async (data) => {
    return data;
  },
};
