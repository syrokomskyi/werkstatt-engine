/*
<MODULE_CONTRACT>
<purpose>
RFC-1326: provisionExternalResources — the internal routine (not a kernel
command) that ensures every external resource a site's generated
wrangler.jsonc binds actually exists before deploy can reach it. Runs
cloudflare.token.check first so a missing permission is named before any
write, then agent.search.index.create for the Vectorize index (rerun-safe
per RFC-1327 — a second provision is a no-op). Consumed by
sternsystem.register (after mission.open) and leitstand.ship (preflight).
</purpose>
<non-goals>
  <item>Do not open missions — the caller guarantees an open mission when missionOpen is true.</item>
  <item>Do not provision R2 or dashboards — only API-creatable bindings.</item>
</non-goals>
<CHANGE_SUMMARY>
  <item>RFC-1326: initial — token preflight + Vectorize index ensure.</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
</CHANGE_SUMMARY>
*/

import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import type { KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

export interface ProvisionResult {
  ok: boolean;
  /** Commands that ran successfully (or no-oped on an existing resource). */
  provisioned: string[];
  /** First failure detail — carries the named missing permission when known. */
  error?: string;
}

async function invoke(
  workspaceRoot: string,
  commandName: string,
  argv: string[],
): Promise<{ exitCode: number; summary?: string; data?: Record<string, unknown> }> {
  const result = (await executeKernelCommand({
    workspaceRoot,
    commandName,
    argv,
    outputFormat: "json",
  })) as { exitCode?: number; summary?: string; data?: Record<string, unknown> };
  return { exitCode: result.exitCode ?? 0, summary: result.summary, data: result.data };
}

/**
 * Ensure the external resources a site's wrangler bindings need exist.
 * `missionOpen` must be true only while a mission is open — the index-create
 * command is mutating and would otherwise fail the mission gate.
 */
export async function provisionExternalResources(
  context: Pick<KernelRuntimeContext, "workspaceRoot" | "logger">,
  opts: { systemId: string; missionOpen: boolean },
): Promise<ProvisionResult> {
  const { workspaceRoot, logger } = context;
  const provisioned: string[] = [];

  // 1. Token preflight — names the missing permission before any write.
  const tokenCheck = await invoke(workspaceRoot, "cloudflare.token.check", []);
  if (tokenCheck.exitCode !== 0) {
    return {
      ok: false,
      provisioned,
      error:
        `cloudflare.token.check failed: ${tokenCheck.summary ?? "unknown"} ` +
        `— add the named permission to the token and re-run`,
    };
  }
  provisioned.push("cloudflare.token.check");

  // 2. Vectorize index ensure — every site's wrangler binds <id>-search.
  if (opts.missionOpen) {
    const indexCreate = await invoke(workspaceRoot, "agent.search.index.create", [
      `--site=${opts.systemId}`,
    ]);
    if (indexCreate.exitCode !== 0) {
      return {
        ok: false,
        provisioned,
        error: `agent.search.index.create failed: ${indexCreate.summary ?? "unknown"}`,
      };
    }
    provisioned.push("agent.search.index.create");
  } else {
    logger.info(
      "  [provision] mission closed — skipping agent.search.index.create (mutating; the index is ensured at birth and first ship)",
    );
  }

  return { ok: true, provisioned };
}
