/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: dht.placement command handler. Determines the best workshop for
placing a site by querying DHT capacity entries. Uses least-loaded strategy
by default, with nearest and owner-preference alternatives.
</purpose>
<non-goals>
  <item>Do not implement actual site migration — this is advisory placement only.</item>
  <item>Do not implement geographic distance — nearest is based on RTT estimation in future phases.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial implementation — dht.placement handler.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";
import type { DHTPlacementResult, DHTPlacementReason, WorkshopCapacity } from "./types.ts";
import { workshopCapacitySchema } from "./types.ts";
import { loadDhtConfig } from "./config.ts";
import { createDhtNode, startDhtNode, stopDhtNode, dhtGet } from "./node.ts";
import { verifyCapacity } from "./capacity.ts";
import {
  WerkstattIdentityConfigSchema,
  type WerkstattIdentityConfig,
} from "@warpgogol/werkstatt-shared/passport";

const IDENTITY_FILENAME = "werkstatt.identity.json";

async function loadIdentityConfig(workspaceRoot: string): Promise<WerkstattIdentityConfig> {
  const identityPath = join(workspaceRoot, IDENTITY_FILENAME);
  const raw = await readFile(identityPath, "utf8");
  const parsed = JSON.parse(raw);
  return WerkstattIdentityConfigSchema.parse(parsed);
}

/**
 * Select the best workshop from a list of capacity entries using least-loaded strategy.
 * Filters out workshops with 0 available slots or invalid signatures.
 */
function selectLeastLoaded(capacities: WorkshopCapacity[]): {
  winner: WorkshopCapacity | null;
  reason: DHTPlacementReason;
} {
  const available = capacities.filter((c) => c.availableSlots > 0);
  if (available.length === 0) {
    return { winner: null, reason: "local-fallback" };
  }
  available.sort((a, b) => {
    // Primary: most available slots
    if (b.availableSlots !== a.availableSlots) {
      return b.availableSlots - a.availableSlots;
    }
    // Secondary: lowest CPU load
    if (a.cpuLoad !== b.cpuLoad) {
      return a.cpuLoad - b.cpuLoad;
    }
    // Tertiary: most disk free
    return b.diskFree - a.diskFree;
  });
  return { winner: available[0]!, reason: "least-loaded" };
}

export async function runDhtPlacement(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DHTPlacementResult>> {
  const { workspaceRoot } = context;
  const siteId = input.flags["site-id"] as string | undefined;
  const strategy = (input.flags["strategy"] as string | undefined) ?? "least-loaded";
  const workshopIds = input.flags["workshops"] as string | string[] | undefined;

  if (!siteId) {
    return {
      data: {
        siteId: "",
        assignedWorkshop: "",
        reason: "local-fallback" as DHTPlacementReason,
        capacity: null,
        diagnostics: ["dht.placement: --site-id flag is required"],
      } as DHTPlacementResult,
      exitCode: 1,
      summary: "[dht.placement] --site-id flag is required",
      nextSteps: [
        { action: "Provide the --site-id flag and re-run dht.placement", kind: "required" },
      ],
    };
  }

  // Load identity config
  let identity: WerkstattIdentityConfig;
  try {
    identity = await loadIdentityConfig(workspaceRoot);
  } catch {
    return {
      data: {
        siteId,
        assignedWorkshop: "",
        reason: "local-fallback" as DHTPlacementReason,
        capacity: null,
        diagnostics: [
          `dht.placement: no ${IDENTITY_FILENAME} found — run identity.bootstrap first (RFC-0558)`,
        ],
      } as DHTPlacementResult,
      exitCode: 1,
      summary: `[dht.placement] identity not bootstrapped`,
      nextSteps: [
        {
          action: "Run identity.bootstrap first (RFC-0558), then re-run dht.placement",
          kind: "required",
        },
      ],
    };
  }

  // Load DHT config
  let config;
  try {
    config = await loadDhtConfig(workspaceRoot);
  } catch {
    return {
      data: {
        siteId,
        assignedWorkshop: "",
        reason: "local-fallback" as DHTPlacementReason,
        capacity: null,
        diagnostics: [`dht.placement: no werkstatt.dht.json found — run dht.node.init first`],
      } as DHTPlacementResult,
      exitCode: 1,
      summary: `[dht.placement] DHT not initialized`,
      nextSteps: [
        { action: "Run dht.node.init first, then re-run dht.placement", kind: "required" },
      ],
    };
  }

  // Determine workshops to query
  const workshops = Array.isArray(workshopIds) ? workshopIds : workshopIds ? [workshopIds] : [];
  if (workshops.length === 0) {
    return {
      data: {
        siteId,
        assignedWorkshop: "",
        reason: "local-fallback" as DHTPlacementReason,
        capacity: null,
        diagnostics: [`dht.placement: --workshops flag is required (comma-separated or repeated)`],
      } as DHTPlacementResult,
      exitCode: 1,
      summary: `[dht.placement] no workshops specified`,
      nextSteps: [
        {
          action:
            "Provide the --workshops flag (comma-separated or repeated) and re-run dht.placement",
          kind: "required",
        },
      ],
    };
  }

  // Create ephemeral DHT node
  let node;
  try {
    node = await createDhtNode(config, identity);
    await startDhtNode(node, config);
  } catch (err) {
    return {
      data: {
        siteId,
        assignedWorkshop: "",
        reason: "local-fallback" as DHTPlacementReason,
        capacity: null,
        diagnostics: [
          `dht.placement: failed to start DHT node — ${err instanceof Error ? err.message : String(err)}`,
        ],
      } as DHTPlacementResult,
      exitCode: 1,
      summary: `[dht.placement] DHT node startup failed`,
      nextSteps: [
        {
          action: "Check the DHT configuration and network connectivity, then re-run dht.placement",
          kind: "required",
        },
      ],
    };
  }

  try {
    // Query capacity for each workshop
    const capacities: WorkshopCapacity[] = [];
    for (const wsId of workshops) {
      const key = `capacity/${wsId}`;
      const valueBytes = await dhtGet(node, key, 3);
      if (!valueBytes) continue;

      try {
        const parsed = JSON.parse(new TextDecoder().decode(valueBytes));
        const capacity = workshopCapacitySchema.parse(parsed);

        // Verify signature
        const sigValid = await verifyCapacity(
          capacity,
          identity.operatorKeyPair.publicKeyMultibase,
        );
        if (sigValid) {
          capacities.push(capacity);
        }
      } catch {
        // Skip malformed entries
      }
    }

    // Select best workshop
    let result: { winner: WorkshopCapacity | null; reason: DHTPlacementReason };

    if (strategy === "owner-preference") {
      // Owner-preference: use the first workshop in the list that has capacity
      const preferred = capacities.find((c) => c.availableSlots > 0);
      result = preferred
        ? { winner: preferred, reason: "owner-preference" }
        : { winner: null, reason: "local-fallback" };
    } else if (strategy === "nearest") {
      // Nearest: in the pilot, this is the same as least-loaded (no RTT data)
      result = selectLeastLoaded(capacities);
      if (result.winner) {
        result.reason = "nearest";
      }
    } else {
      // Default: least-loaded
      result = selectLeastLoaded(capacities);
    }

    return {
      data: {
        siteId,
        assignedWorkshop: result.winner?.workshopId ?? "",
        reason: result.reason,
        capacity: result.winner,
      },
      exitCode: 0,
      summary: result.winner
        ? `[dht.placement] ${siteId} → ${result.winner.workshopId} (${result.reason})`
        : `[dht.placement] no available workshop for ${siteId} (local-fallback)`,
    };
  } finally {
    await stopDhtNode(node);
  }
}
