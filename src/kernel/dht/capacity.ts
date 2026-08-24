/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: dht.capacity.publish command handler. Publishes workshop capacity
(available slots, storage limit, bandwidth limit) to the DHT so placement
decisions can use real-time capacity data. Signs the capacity entry with the
operator's Ed25519 keypair.
</purpose>
<non-goals>
  <item>Do not implement placement logic — that lives in placement.ts.</item>
  <item>Do not implement capacity monitoring — the operator declares capacity manually.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial implementation — dht.capacity.publish handler.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";
import type { WorkshopCapacity } from "./types.ts";
import { workshopCapacitySchema } from "./types.ts";
import { loadDhtConfig } from "./config.ts";
import { createDhtNode, startDhtNode, stopDhtNode, dhtPut } from "./node.ts";
import { signBytes, verifyBytes } from "@warpgogol/werkstatt-shared/passport/sign";
import {
  WerkstattIdentityConfigSchema,
  type WerkstattIdentityConfig,
} from "@warpgogol/werkstatt-shared/passport";

const IDENTITY_FILENAME = "werkstatt.identity.json";
const PASSPORT_SIGNING_KEY_ENV = "PASSPORT_SIGNING_KEY";

interface DhtCapacityPublishResult {
  published: boolean;
  workshopId: string;
  key: string;
  capacity: WorkshopCapacity | null;
  diagnostics?: string[];
}

async function loadIdentityConfig(workspaceRoot: string): Promise<WerkstattIdentityConfig> {
  const identityPath = join(workspaceRoot, IDENTITY_FILENAME);
  const raw = await readFile(identityPath, "utf8");
  const parsed = JSON.parse(raw);
  return WerkstattIdentityConfigSchema.parse(parsed);
}

function getSigningKey(): string {
  const key = process.env[PASSPORT_SIGNING_KEY_ENV];
  if (!key || key.length === 0) {
    throw new Error(`${PASSPORT_SIGNING_KEY_ENV} environment variable is not set`);
  }
  return key;
}

/**
 * Produce canonical UTF-8 bytes from a capacity entry (excluding signature).
 */
function capacityBytes(capacity: Omit<WorkshopCapacity, "signature">): Uint8Array {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(capacity).sort()) {
    sorted[key] = (capacity as Record<string, unknown>)[key];
  }
  return new TextEncoder().encode(JSON.stringify(sorted));
}

export async function runDhtCapacityPublish(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DhtCapacityPublishResult>> {
  const { workspaceRoot } = context;
  const workshopId = input.flags["workshop-id"] as string | undefined;
  const availableSlots = input.flags["available-slots"] as string | undefined;
  const storageLimitMb = input.flags["storage-limit-mb"] as string | undefined;
  const bandwidthLimitMbps = input.flags["bandwidth-limit-mbps"] as string | undefined;

  if (!workshopId) {
    return {
      data: {
        published: false,
        workshopId: "",
        key: "",
        capacity: null,
        diagnostics: ["dht.capacity.publish: --workshop-id flag is required"],
      },
      exitCode: 1,
      summary: "[dht.capacity.publish] --workshop-id flag is required",
      nextSteps: [
        {
          action: "Provide the --workshop-id flag and re-run dht.capacity.publish",
          kind: "required",
        },
      ],
    };
  }

  if (availableSlots === undefined) {
    return {
      data: {
        published: false,
        workshopId,
        key: "",
        capacity: null,
        diagnostics: ["dht.capacity.publish: --available-slots flag is required"],
      },
      exitCode: 1,
      summary: "[dht.capacity.publish] --available-slots flag is required",
      nextSteps: [
        {
          action: "Provide the --available-slots flag and re-run dht.capacity.publish",
          kind: "required",
        },
      ],
    };
  }

  const slots = parseInt(availableSlots, 10);
  const storage = storageLimitMb ? parseInt(storageLimitMb, 10) : 0;
  const bandwidth = bandwidthLimitMbps ? parseInt(bandwidthLimitMbps, 10) : 0;
  const endpoint = (input.flags["endpoint"] as string | undefined) ?? "0.0.0.0:0";

  // Load identity config
  let identity: WerkstattIdentityConfig;
  try {
    identity = await loadIdentityConfig(workspaceRoot);
  } catch {
    return {
      data: {
        published: false,
        workshopId,
        key: "",
        capacity: null,
        diagnostics: [
          `dht.capacity.publish: no ${IDENTITY_FILENAME} found — run identity.bootstrap first (RFC-0558)`,
        ],
      },
      exitCode: 1,
      summary: `[dht.capacity.publish] identity not bootstrapped`,
      nextSteps: [
        {
          action: "Run identity.bootstrap first (RFC-0558), then re-run dht.capacity.publish",
          kind: "required",
        },
      ],
    };
  }

  // Get signing key
  let signingKey: string;
  try {
    signingKey = getSigningKey();
  } catch {
    return {
      data: {
        published: false,
        workshopId,
        key: "",
        capacity: null,
        diagnostics: [
          `dht.capacity.publish: ${PASSPORT_SIGNING_KEY_ENV} environment variable is not set`,
        ],
      },
      exitCode: 1,
      summary: `[dht.capacity.publish] ${PASSPORT_SIGNING_KEY_ENV} not set`,
      nextSteps: [
        {
          action: `Set the ${PASSPORT_SIGNING_KEY_ENV} environment variable and re-run dht.capacity.publish`,
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
        published: false,
        workshopId,
        key: "",
        capacity: null,
        diagnostics: [
          `dht.capacity.publish: no werkstatt.dht.json found — run dht.node.init first`,
        ],
      },
      exitCode: 1,
      summary: `[dht.capacity.publish] DHT not initialized`,
      nextSteps: [
        { action: "Run dht.node.init first, then re-run dht.capacity.publish", kind: "required" },
      ],
    };
  }

  // Build capacity entry
  const now = new Date().toISOString();
  const capacityData = {
    workshopId,
    endpoint,
    availableSlots: slots,
    storageLimitMb: storage,
    bandwidthLimitMbps: bandwidth,
    activeMissions: 0,
    maxMissions: slots,
    cpuLoad: 0,
    diskFree: 0,
    updatedAt: now,
  };

  // Sign the capacity entry
  let signature: string;
  try {
    signature = await signBytes(signingKey, capacityBytes(capacityData));
  } catch (err) {
    return {
      data: {
        published: false,
        workshopId,
        key: "",
        capacity: null,
        diagnostics: [
          `dht.capacity.publish: failed to sign capacity — ${err instanceof Error ? err.message : String(err)}`,
        ],
      },
      exitCode: 1,
      summary: `[dht.capacity.publish] signing failed`,
      nextSteps: [
        {
          action:
            "Check the PASSPORT_SIGNING_KEY environment variable and re-run dht.capacity.publish",
          kind: "required",
        },
      ],
    };
  }

  const capacity: WorkshopCapacity = { ...capacityData, signature };

  // Validate
  try {
    workshopCapacitySchema.parse(capacity);
  } catch {
    return {
      data: {
        published: false,
        workshopId,
        key: "",
        capacity: null,
        diagnostics: [`dht.capacity.publish: capacity entry failed schema validation`],
      },
      exitCode: 1,
      summary: `[dht.capacity.publish] schema validation failed`,
      nextSteps: [
        {
          action: "Check the capacity entry fields and re-run dht.capacity.publish",
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
        published: false,
        workshopId,
        key: "",
        capacity: null,
        diagnostics: [
          `dht.capacity.publish: failed to start DHT node — ${err instanceof Error ? err.message : String(err)}`,
        ],
      },
      exitCode: 1,
      summary: `[dht.capacity.publish] DHT node startup failed`,
      nextSteps: [
        {
          action:
            "Check the DHT configuration and network connectivity, then re-run dht.capacity.publish",
          kind: "required",
        },
      ],
    };
  }

  try {
    const key = `capacity/${workshopId}`;
    const valueBytes = new TextEncoder().encode(JSON.stringify(capacity));
    await dhtPut(node, key, valueBytes);

    return {
      data: {
        published: true,
        workshopId,
        key,
        capacity,
      },
      exitCode: 0,
      summary: `[dht.capacity.publish] published capacity for ${workshopId} (${slots} slots)`,
    };
  } finally {
    await stopDhtNode(node);
  }
}

/**
 * Verify a capacity entry signature.
 */
export async function verifyCapacity(
  capacity: WorkshopCapacity,
  publicKeyMultibase: string,
): Promise<boolean> {
  const { signature, ...data } = capacity;
  return verifyBytes(publicKeyMultibase, capacityBytes(data), signature);
}
