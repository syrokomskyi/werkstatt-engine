/*
<MODULE_CONTRACT>
<purpose>
Unit tests for nachweis cloudflare agent readiness measure covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the nachweis suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import "./load-verification.test.ts";
