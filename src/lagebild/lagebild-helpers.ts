/*
<MODULE_CONTRACT>
  <purpose>RFC-1065: Shared helpers for lagebild commands — resolve worker name from system-config, read lagebild state, and define secret name constants.</purpose>


  <non-goals>
    <item>Do not perform file IO — use passed-in SystemConfig/SystemState objects only.</item>
    <item>Do not make network calls.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1065: initial lagebild helpers for connect, validate, and status commands.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import type { SystemConfig, SystemState } from "../schemas/sternsystem.ts";

export const LAGEBILD_SECRET_NAMES = [
  "LAGEBILD_API_URL",
  "LAGEBILD_API_KEY",
  "LAGEBILD_TENANT_ID",
  "LAGEBILD_SOURCE_SYSTEM_ID",
] as const;

export type LagebildSecretName = (typeof LAGEBILD_SECRET_NAMES)[number];

export type ChannelName = "dev" | "alt" | "main";

export function resolveWorkerName(config: SystemConfig, channel: string): string {
  if (!config.deployment) {
    throw new Error(
      `[lagebild] No deployment configuration in system-config.yaml. Cannot resolve worker name.`,
    );
  }
  const ch = config.deployment.channels[channel as ChannelName];
  if (!ch) {
    throw new Error(
      `[lagebild] Channel "${channel}" not found in system-config.yaml deployment.channels. Available: dev, alt, main.`,
    );
  }
  return ch.workerName;
}

export function readLagebildState(state: SystemState): SystemState["lagebild"] {
  return state.lagebild;
}
