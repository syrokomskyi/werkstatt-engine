/*
<MODULE_CONTRACT>
<purpose>RFC-0757: no-op migrator — the send-message section defaults to the 2-item
checklist (length + contact) when checklistItems[] is absent. This migrator exists
solely to advance the migratorCursor so that systems absorbing a post-RFC-0757
platform version record the migration as applied. It performs no file transforms.</purpose>
<non-goals>
  <item>Do not transform any authored content — defaults work when checklistItems[] is absent.</item>
  <item>Do not delete or rename any files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0757: initial no-op migrator — advances migratorCursor without file transforms.</item>
</CHANGE_SUMMARY>
*/

import type { Migrator } from "./types.ts";

export const RFC_0757_MIGRATOR_ID = "rfc-0757";

export const rfc0757Migrator: Migrator = {
  id: RFC_0757_MIGRATOR_ID,
  fromVersion: "4.70.10",
  toVersion: "4.71.0",
  description:
    "No-op migrator — send-message checklistItems[] defaults work when prop is absent. Advances migratorCursor for RFC-0757 (generalize checklist from 2 hardcoded items to N configurable items).",
  transform: async (data) => {
    return data;
  },
};
