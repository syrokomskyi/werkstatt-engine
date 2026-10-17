/*
<MODULE_CONTRACT>
<purpose>
Unit tests for rfc 0500 covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the rfc suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import "./rfc-0500.pbt.test.ts";
import "./rfc-0500.snapshot.test.ts";
