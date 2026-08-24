/*
<MODULE_CONTRACT>
<purpose>Facilitates changelog operations by exporting command functions for generation, index rebuilding, and backfilling.</purpose>
<non-goals>
  <item>Do not implement changelog parsing logic.</item>
  <item>Do not manage changelog storage or retrieval.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/

export {
  runChangelogGenerate,
  runChangelogRebuildIndex,
  runChangelogBackfill,
} from "./changelog-command.ts";
