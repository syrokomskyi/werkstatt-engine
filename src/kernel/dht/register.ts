/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: dht.register command handler. Publishes a local registry entry to
the DHT. Signs the entry with the operator's Ed25519 keypair. Uses LWW (last-
writer-wins) on lastUpdated timestamp for conflict resolution, with owner-
signature priority for equal timestamps.
</purpose>
<non-goals>
  <item>Do not implement DHT routing — that lives in node.ts.</item>
  <item>Do not implement local registry management — the local registry is authoritative.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial implementation — dht.register with LWW conflict resolution.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";
import type { DHTSiteEntry } from "./types.ts";
import { dhtSiteEntrySchema } from "./types.ts";
import { loadDhtConfig } from "./config.ts";
import { clearCachedEntry } from "./cache.ts";
import { createDhtNode, startDhtNode, stopDhtNode, dhtPut, dhtGet } from "./node.ts";
import { signDhtEntry, verifyDhtEntry } from "@warpgogol/werkstatt-shared/passport/dht-sign";
import {
  WerkstattIdentityConfigSchema,
  type WerkstattIdentityConfig,
} from "@warpgogol/werkstatt-shared/passport";

const IDENTITY_FILENAME = "werkstatt.identity.json";
const PASSPORT_SIGNING_KEY_ENV = "PASSPORT_SIGNING_KEY";

interface DhtRegisterResult {
  registered: boolean;
  siteId: string;
  key: string;
  conflictResolved: boolean;
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
 * Compare two DHT entries by LWW on lastUpdated timestamp.
 * For equal timestamps, owner-signature priority: the entry with a valid
 * signature from the declared owner wins. If both have valid signatures,
 * the existing entry wins (conservative — avoids flapping).
 */
function resolveConflict(
  existing: DHTSiteEntry,
  candidate: DHTSiteEntry,
): { winner: DHTSiteEntry; reason: "newer" | "equal-existing" } {
  const existingTime = new Date(existing.lastUpdated).getTime();
  const candidateTime = new Date(candidate.lastUpdated).getTime();

  if (candidateTime > existingTime) {
    return { winner: candidate, reason: "newer" };
  }
  // Equal or older — keep existing (conservative LWW)
  return { winner: existing, reason: "equal-existing" };
}

export async function runDhtRegister(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DhtRegisterResult>> {
  const { workspaceRoot } = context;
  const siteId = input.flags["site-id"] as string | undefined;
  const owner = input.flags["owner"] as string | undefined;
  const workshopEndpoint = input.flags["endpoint"] as string | undefined;
  const mirrorsFlag = input.flags["mirrors"] as string | string[] | undefined;

  if (!siteId) {
    return {
      data: {
        registered: false,
        siteId: "",
        key: "",
        conflictResolved: false,
        diagnostics: ["dht.register: --site-id flag is required"],
      },
      exitCode: 1,
      summary: "[dht.register] --site-id flag is required",
      nextSteps: [
        { action: "Provide the --site-id flag and re-run dht.register", kind: "required" },
      ],
    };
  }

  if (!owner) {
    return {
      data: {
        registered: false,
        siteId,
        key: "",
        conflictResolved: false,
        diagnostics: ["dht.register: --owner flag is required (did:web identifier)"],
      },
      exitCode: 1,
      summary: "[dht.register] --owner flag is required",
      nextSteps: [
        {
          action: "Provide the --owner flag (did:web identifier) and re-run dht.register",
          kind: "required",
        },
      ],
    };
  }

  if (!workshopEndpoint) {
    return {
      data: {
        registered: false,
        siteId,
        key: "",
        conflictResolved: false,
        diagnostics: ["dht.register: --endpoint flag is required (host:port)"],
      },
      exitCode: 1,
      summary: "[dht.register] --endpoint flag is required",
      nextSteps: [
        {
          action: "Provide the --endpoint flag (host:port) and re-run dht.register",
          kind: "required",
        },
      ],
    };
  }

  const mirrors = Array.isArray(mirrorsFlag) ? mirrorsFlag : mirrorsFlag ? [mirrorsFlag] : [];

  // Load identity config
  let identity: WerkstattIdentityConfig;
  try {
    identity = await loadIdentityConfig(workspaceRoot);
  } catch {
    return {
      data: {
        registered: false,
        siteId,
        key: "",
        conflictResolved: false,
        diagnostics: [
          `dht.register: no ${IDENTITY_FILENAME} found — run identity.bootstrap first (RFC-0558)`,
        ],
      },
      exitCode: 1,
      summary: `[dht.register] identity not bootstrapped`,
      nextSteps: [
        {
          action: "Run identity.bootstrap first (RFC-0558), then re-run dht.register",
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
        registered: false,
        siteId,
        key: "",
        conflictResolved: false,
        diagnostics: [`dht.register: ${PASSPORT_SIGNING_KEY_ENV} environment variable is not set`],
      },
      exitCode: 1,
      summary: `[dht.register] ${PASSPORT_SIGNING_KEY_ENV} not set`,
      nextSteps: [
        {
          action: `Set the ${PASSPORT_SIGNING_KEY_ENV} environment variable and re-run dht.register`,
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
        registered: false,
        siteId,
        key: "",
        conflictResolved: false,
        diagnostics: [`dht.register: no werkstatt.dht.json found — run dht.node.init first`],
      },
      exitCode: 1,
      summary: `[dht.register] DHT not initialized`,
      nextSteps: [
        { action: "Run dht.node.init first, then re-run dht.register", kind: "required" },
      ],
    };
  }

  // Build the DHT entry
  const now = new Date().toISOString();
  const entryData = {
    siteId,
    owner,
    workshopEndpoint,
    mirrors,
    registeredAt: now,
    lastUpdated: now,
  };

  // Sign the entry
  let signature: string;
  try {
    signature = await signDhtEntry(entryData, signingKey);
  } catch (err) {
    return {
      data: {
        registered: false,
        siteId,
        key: "",
        conflictResolved: false,
        diagnostics: [
          `dht.register: failed to sign entry — ${err instanceof Error ? err.message : String(err)}`,
        ],
      },
      exitCode: 1,
      summary: `[dht.register] signing failed`,
      nextSteps: [
        {
          action: "Check the PASSPORT_SIGNING_KEY environment variable and re-run dht.register",
          kind: "required",
        },
      ],
    };
  }

  const candidateEntry: DHTSiteEntry = { ...entryData, signature };

  // Create ephemeral DHT node
  let node;
  try {
    node = await createDhtNode(config, identity);
    await startDhtNode(node, config);
  } catch (err) {
    return {
      data: {
        registered: false,
        siteId,
        key: "",
        conflictResolved: false,
        diagnostics: [
          `dht.register: failed to start DHT node — ${err instanceof Error ? err.message : String(err)}`,
        ],
      },
      exitCode: 1,
      summary: `[dht.register] DHT node startup failed`,
      nextSteps: [
        {
          action: "Check the DHT configuration and network connectivity, then re-run dht.register",
          kind: "required",
        },
      ],
    };
  }

  try {
    const key = `site/${siteId}`;

    // Check for existing entry (LWW conflict resolution)
    let conflictResolved = false;
    const entryToPublish = candidateEntry;

    const existingBytes = await dhtGet(node, key, 3);
    if (existingBytes) {
      try {
        const existingParsed = JSON.parse(new TextDecoder().decode(existingBytes));
        const existingEntry = dhtSiteEntrySchema.parse(existingParsed);

        // Verify existing entry signature before considering it for conflict resolution
        const existingSigValid = await verifyDhtEntry(
          existingEntry,
          identity.operatorKeyPair.publicKeyMultibase,
        );

        if (existingSigValid) {
          const { winner, reason } = resolveConflict(existingEntry, candidateEntry);
          if (winner === candidateEntry) {
            conflictResolved = true;
          } else {
            // Existing entry wins — don't overwrite
            return {
              data: {
                registered: false,
                siteId,
                key,
                conflictResolved: true,
                diagnostics: [
                  `dht.register: existing entry is newer or equal (LWW: ${reason}) — not overwriting`,
                ],
              },
              exitCode: 0,
              summary: `[dht.register] existing entry wins (LWW ${reason})`,
            };
          }
        }
        // If existing entry has invalid signature, overwrite with our valid entry
      } catch {
        // Existing entry is malformed — overwrite with our valid entry
        conflictResolved = true;
      }
    }

    // Publish to DHT
    const valueBytes = new TextEncoder().encode(JSON.stringify(entryToPublish));
    await dhtPut(node, key, valueBytes);

    // Invalidate cache entry for this site (entry has changed)
    await clearCachedEntry(workspaceRoot, siteId);

    return {
      data: {
        registered: true,
        siteId,
        key,
        conflictResolved,
      },
      exitCode: 0,
      summary: `[dht.register] published ${siteId} to DHT key ${key}`,
    };
  } finally {
    await stopDhtNode(node);
  }
}
