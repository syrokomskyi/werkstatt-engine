/*
<MODULE_CONTRACT>
<purpose>RFC-0496: no-op migrator — service dossier pages are generated from
blueprint + service content records, not authored content transforms. This
migrator exists solely to advance the migratorCursor so that systems absorbing
a post-RFC-0496 platform version record the migration as applied. It performs
no file transforms.</purpose>
<non-goals>
  <item>Do not transform any authored content — service pages are generated from blueprint templates.</item>
  <item>Do not delete or rename any files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0496: initial no-op migrator — advances migratorCursor without file transforms.</item>
</CHANGE_SUMMARY>
*/

import type { Migrator } from "./types.ts";

export const RFC_0496_MIGRATOR_ID = "rfc-0496";

export const rfc0496Migrator: Migrator = {
  id: RFC_0496_MIGRATOR_ID,
  fromVersion: "4.9.0",
  toVersion: "4.10.0",
  description:
    "No-op migrator — service dossier pages are generated from blueprint + service content records. Advances migratorCursor for RFC-0496 (website-service surface, services content collection, service dossier baker).",
  transform: async (data) => {
    return data;
  },
};
