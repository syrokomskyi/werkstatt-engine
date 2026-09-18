/*
<MODULE_CONTRACT>
<purpose>RFC-0357: behavior snapshot command module — registers behavior.snapshot.capture and behavior.snapshot.diff.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0357: initial behavior snapshot module.</item>
</CHANGE_SUMMARY>
*/


export {
  runBehaviorSnapshotCapture,
  type BehaviorSnapshotCaptureData,
  runBehaviorSnapshotDiff,
  type BehaviorSnapshotDiffData,
} from "./behavior-snapshot-commands.ts";

