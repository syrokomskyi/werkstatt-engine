/*
<MODULE_CONTRACT>
<purpose>Werkstatt helpers — lock, operation, and atomic write utilities used by handoff machinery.</purpose>
<non-goals>
  <item>Do not register commands here — werkstatt command module migrated to @warpgogol/forge.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0362: initial Werkstatt command module.</item>
  <item>RFC-0374: createWerkstattModule migrated to @warpgogol/forge — helpers remain for handoff use.</item>
</CHANGE_SUMMARY>
*/

export { runWerkstattLockStatus, type WerkstattLockStatusData } from "./werkstatt-lock-status.ts";
export {
  runWerkstattLockRecover,
  type WerkstattLockRecoverData,
} from "./werkstatt-lock-recover.ts";
export { acquireLock, releaseLock, heartbeatLock, readAllLocks, isLockStale } from "./lock.ts";
export {
  startOperation,
  completeOperation,
  failOperation,
  readOperation,
  computeInputHash,
  generateOperationId,
} from "./operation.ts";
export { atomicWriteFile, atomicMoveDir, resolveStagingDir } from "./atomic.ts";
export { gitExec } from "./git-exec.ts";
export { commitWerkstattSideEffects, type CommitWerkstattResult } from "./werkstatt-commit.ts";
