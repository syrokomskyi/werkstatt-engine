/*
<MODULE_CONTRACT>
<purpose>RFC-0359 + RFC-0380: notausgang module exports and command registration. RFC-0380 adds CheckStatus and NotausgangViolation types.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0359: initial notausgang module.</item>
  <item>RFC-0380: export CheckStatus, NotausgangViolation types; update command descriptions for deep validation.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";
import { runNotausgangExport, runNotausgangValidate } from "./notausgang-commands.ts";

export {
  runNotausgangExport,
  type NotausgangExportData,
  runNotausgangValidate,
  type NotausgangValidateData,
  type CheckStatus,
  type NotausgangViolation,
} from "./notausgang-commands.ts";

