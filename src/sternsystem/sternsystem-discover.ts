/*
<MODULE_CONTRACT>
<purpose>RFC-0790: sternsystem.discover — scan ../systems-cache/ and list all discovered systems.</purpose>
<non-goals>
  <item>Does not mutate state — read-only discovery command.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0790: initial discover command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { discoverSystems } from "./registry-io.ts";

export interface SternsystemDiscoverData {
  systems: Array<{
    id: string;
    cosmicStar: string;
    status: string;
    pinnedPlatform: string;
    registeredAt: string;
  }>;
  errors: Array<{ id: string; error: string }>;
  count: number;
}

export async function runSternsystemDiscover(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemDiscoverData>> {
  const { workspaceRoot, logger } = context;
  const { systems, errors } = await discoverSystems(workspaceRoot);

  const summary = systems.map((s) => ({
    id: s.id,
    cosmicStar: s.cosmicStar,
    status: s.status,
    pinnedPlatform: s.pinnedPlatform,
    registeredAt: s.registeredAt,
  }));

  for (const s of summary) {
    logger.info(
      `  ${s.id.padEnd(24)} ${s.cosmicStar.padEnd(12)} ${s.status.padEnd(12)} ${s.pinnedPlatform}`,
    );
  }

  for (const err of errors) {
    logger.warn(`  [error] ${err.id}: ${err.error}`);
  }

  return {
    data: { systems: summary, errors, count: summary.length },
    summary: `[sternsystem.discover] ${summary.length} system${summary.length === 1 ? "" : "s"} discovered${errors.length > 0 ? `, ${errors.length} error${errors.length === 1 ? "" : "s"}` : ""}`,
    nextSteps: [
      {
        action: `Validate discovered systems: pnpm exec werkstatt run sternsystem.validate`,
        kind: "optional",
      },
    ],
  };
}
