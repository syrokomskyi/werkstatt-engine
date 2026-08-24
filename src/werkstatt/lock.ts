/*
<MODULE_CONTRACT>
<purpose>Werkstatt lock helpers. Canonical implementation now lives in
@warpgogol/forge/os/werkstatt/handlers/ (RFC-0556 dependency inversion). This file
re-exports them for backward-compatible imports from @warpgogol/site-kernel-handoff.</purpose>
<non-goals>
  <item>Do not duplicate the implementation — always re-export from forge.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0362: initial lock helpers (acquire, release, heartbeat, status).</item>
  <item>RFC-0556: moved canonical implementation to @warpgogol/forge, this file is now a re-export.</item>
</CHANGE_SUMMARY>
*/

export {
  acquireLock,
  releaseLock,
  heartbeatLock,
  readAllLocks,
  isLockStale,
  removeStaleLock,
} from "@warpgogol/forge/os/werkstatt";
export type { WerkstattLock } from "@warpgogol/forge/os/werkstatt";
