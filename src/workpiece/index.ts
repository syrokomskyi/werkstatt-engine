/*
<MODULE_CONTRACT>
<purpose>
RFC-0555: barrel export for workpiece commands (workpiece.read, workpiece.write)
and the shared DNA-22 path validation checker.
</purpose>
<non-goals>
  <item>Does not register commands — that is mission.module.ts's job.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0555: initial barrel export for workpiece commands.</item>
</CHANGE_SUMMARY>
*/

export {
  isClientEditable,
  createClientEditableChecker,
  type ClientEditableChecker,
} from "./dna-22-checker.ts";
export { runWorkpieceRead, type WorkpieceReadResult } from "./workpiece-read.ts";
export { runWorkpieceWrite, type WorkpieceWriteResult } from "./workpiece-write.ts";
