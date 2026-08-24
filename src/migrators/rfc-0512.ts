/*
<MODULE_CONTRACT>
<purpose>RFC-0512: no-op migrator — team JSON endpoints and Schema.org are C-contract
changes (new JSON-LD types, new URL patterns, new surface policies), not data contract
changes. This migrator exists solely to advance the migratorCursor so that systems
absorbing a post-RFC-0512 platform version record the migration as applied. It performs
no file transforms.</purpose>
<non-goals>
  <item>Do not transform any authored content — the JSON endpoints and JSON-LD are generated at build time.</item>
  <item>Do not delete or rename any files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0512: initial no-op migrator — advances migratorCursor without file transforms.</item>
</CHANGE_SUMMARY>
*/

import type { Migrator } from "./types.ts";

export const RFC_0512_MIGRATOR_ID = "rfc-0512";

export const rfc0512Migrator: Migrator = {
  id: RFC_0512_MIGRATOR_ID,
  fromVersion: "4.17.0",
  toVersion: "4.18.0",
  description:
    "No-op migrator — team JSON endpoints and Schema.org are C-contract changes, not data contract changes. Advances migratorCursor for RFC-0512.",
  transform: async (data) => {
    return data;
  },
};
