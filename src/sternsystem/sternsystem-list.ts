/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/sternsystem/sternsystem-list.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0354: initial list command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { discoverSystems, readSystemState } from "./registry-io.ts";

export interface SternsystemListData {
  systems: Array<{
    id: string;
    cosmicStar: string;
    mirrors: Array<{ path: string; storageType: string }>;
    pinnedPlatform: string;
    currentMission: string | null;
    lastRelease: string | null;
    status: string;
    registeredAt: string;
  }>;
  count: number;
}

export async function runSternsystemList(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemListData>> {
  const { workspaceRoot, logger } = context;
  const { systems: configs } = await discoverSystems(workspaceRoot);

  const systems = await Promise.all(
    configs.map(async (c) => {
      const state = await readSystemState(workspaceRoot, c.id);
      return {
        id: c.id,
        cosmicStar: c.cosmicStar,
        mirrors: c.mirrors,
        pinnedPlatform: c.pinnedPlatform,
        currentMission: state.currentMission,
        lastRelease: state.lastRelease,
        status: c.status,
        registeredAt: c.registeredAt,
      };
    }),
  );

  for (const s of systems) {
    logger.info(
      `  ${s.id.padEnd(24)} ${s.cosmicStar.padEnd(12)} ${s.status.padEnd(12)} ${s.pinnedPlatform}`,
    );
  }

  return {
    data: { systems, count: systems.length },
    summary: `[sternsystem.list] ${systems.length} system${systems.length === 1 ? "" : "s"} registered`,
    nextSteps:
      systems.length === 0
        ? [
            {
              action: `Onboard a new system: pnpm exec forge run onboarding.scaffold --system-id <id>`,
              kind: "optional",
            },
          ]
        : undefined,
  };
}
