/*
<MODULE_CONTRACT>
<purpose>Maintains packages/fingerprint/src/tests/fixtures/ts-comment.after.ts as an authored fingerprint test module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not encode production behavior here; keep this file focused on regression detection for its owning package.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Post-refactor Compass backfill: added durable source-file contracts for future AI-agent maintenance.</item>
</CHANGE_SUMMARY>
*/
// This comment was changed
export const value = 42;
