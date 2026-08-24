/*
<MODULE_CONTRACT>
<purpose>RFC-0498: no-op migrator — per-depth JSON-LD type policy is a C-contract
change, not a data contract change. This migrator exists solely to advance the
migratorCursor so that systems absorbing a post-RFC-0498 platform version
record the migration as applied. It performs no file transforms.</purpose>
<non-goals>
  <item>Do not transform any authored content — the policy is enforced at build time via C-contract validation.</item>
  <item>Do not delete or rename any files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0498: initial no-op migrator — advances migratorCursor without file transforms.</item>
</CHANGE_SUMMARY>
*/

import type { Migrator } from "./types.ts";

export const RFC_0498_MIGRATOR_ID = "rfc-0498";

export const rfc0498Migrator: Migrator = {
  id: RFC_0498_MIGRATOR_ID,
  fromVersion: "4.11.0",
  toVersion: "4.12.0",
  description:
    "No-op migrator — per-depth JSON-LD type policy is a C-contract change, not a data contract change. Advances migratorCursor for RFC-0498 (structured data policy for all surface depths).",
  transform: async (data) => {
    return data;
  },
};
