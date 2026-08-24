/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: dht.lookup command handler. Resolves a site id to its DHT entry
by querying the DHT (or local cache if fresh). Validates entry signatures
against the owner's public key. Routes around dead workshops detected by SWIM.
</purpose>
<non-goals>
  <item>Do not implement DHT routing — that lives in node.ts.</item>
  <item>Do not implement cache invalidation push — TTL-only per RFC-0565 design.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial implementation — dht.lookup with cache and signature validation.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";
import type { DHTLookupResult, DHTSiteEntry } from "./types.ts";
import { dhtSiteEntrySchema } from "./types.ts";
import { loadDhtConfig } from "./config.ts";
import { getCachedEntry, setCachedEntry, loadCache } from "./cache.ts";
import { createDhtNode, startDhtNode, stopDhtNode, dhtGet } from "./node.ts";
import { verifyDhtEntry } from "@warpgogol/werkstatt-shared/passport/dht-sign";
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
 * Check if a workshop endpoint is in the SWIM dead members list.
 * Returns true if the workshop is alive (or SWIM is not configured).
 */
async function isWorkshopAlive(_workspaceRoot: string, _endpoint: string): Promise<boolean> {
  // In the pilot, SWIM dead-workshop detection is handled by the DHT routing
  // layer itself (it skips unreachable peers). This function is a seam for
  // future integration with SWIM membership view.
  return true;
}

export async function runDhtLookup(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DHTLookupResult>> {
  const { workspaceRoot } = context;
  const siteId = input.flags["site-id"] as string | undefined;
  const forceRefresh = input.flags["force"] === true;

  if (!siteId) {
    return {
      data: {
        found: false,
        entry: null,
        hops: 0,
        latencyMs: 0,
        cached: false,
        signatureValid: false,
        diagnostics: ["dht.lookup: --site-id flag is required"],
      },
      exitCode: 1,
      summary: "[dht.lookup] --site-id flag is required",
      nextSteps: [{ action: "Provide the --site-id flag and re-run dht.lookup", kind: "required" }],
    };
  }

  const startTime = Date.now();

  // 1. Check local cache first (unless --force)
  if (!forceRefresh) {
    const cache = await loadCache(workspaceRoot);
    const cached = getCachedEntry(cache, siteId);
    if (cached) {
      const alive = await isWorkshopAlive(workspaceRoot, cached.workshopEndpoint);
      if (alive) {
        return {
          data: {
            found: true,
            entry: cached,
            hops: 0,
            latencyMs: Date.now() - startTime,
            cached: true,
            signatureValid: true,
          },
          exitCode: 0,
          summary: `[dht.lookup] cache hit for ${siteId}`,
        };
      }
    }
  }

  // 2. Load DHT config
  let config;
  try {
    config = await loadDhtConfig(workspaceRoot);
  } catch {
    return {
      data: {
        found: false,
        entry: null,
        hops: 0,
        latencyMs: Date.now() - startTime,
        cached: false,
        signatureValid: false,
        diagnostics: [`dht.lookup: no werkstatt.dht.json found — run dht.node.init first`],
      },
      exitCode: 1,
      summary: `[dht.lookup] DHT not initialized — run dht.node.init first`,
      nextSteps: [{ action: "Run dht.node.init first, then re-run dht.lookup", kind: "required" }],
    };
  }

  // 3. Load identity config
  let identity: WerkstattIdentityConfig;
  try {
    identity = await loadIdentityConfig(workspaceRoot);
  } catch {
    return {
      data: {
        found: false,
        entry: null,
        hops: 0,
        latencyMs: Date.now() - startTime,
        cached: false,
        signatureValid: false,
        diagnostics: [
          `dht.lookup: no ${IDENTITY_FILENAME} found — run identity.bootstrap first (RFC-0558)`,
        ],
      },
      exitCode: 1,
      summary: `[dht.lookup] identity not bootstrapped`,
      nextSteps: [
        {
          action: "Run identity.bootstrap first (RFC-0558), then re-run dht.lookup",
          kind: "required",
        },
      ],
    };
  }

  // 4. Create ephemeral DHT node and query
  let node;
  try {
    node = await createDhtNode(config, identity);
    await startDhtNode(node, config);
  } catch (err) {
    return {
      data: {
        found: false,
        entry: null,
        hops: 0,
        latencyMs: Date.now() - startTime,
        cached: false,
        signatureValid: false,
        diagnostics: [
          `dht.lookup: failed to start DHT node — ${err instanceof Error ? err.message : String(err)}`,
        ],
      },
      exitCode: 1,
      summary: `[dht.lookup] DHT node startup failed`,
      nextSteps: [
        {
          action: "Check the DHT configuration and network connectivity, then re-run dht.lookup",
          kind: "required",
        },
      ],
    };
  }

  try {
    const key = `site/${siteId}`;
    const valueBytes = await dhtGet(node, key, 3);

    if (!valueBytes) {
      return {
        data: {
          found: false,
          entry: null,
          hops: 0,
          latencyMs: Date.now() - startTime,
          cached: false,
          signatureValid: false,
        },
        exitCode: 0,
        summary: `[dht.lookup] site ${siteId} not found in DHT`,
      };
    }

    // 5. Parse and validate the DHT entry
    let entry: DHTSiteEntry;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(valueBytes));
      entry = dhtSiteEntrySchema.parse(parsed);
    } catch {
      return {
        data: {
          found: false,
          entry: null,
          hops: 0,
          latencyMs: Date.now() - startTime,
          cached: false,
          signatureValid: false,
          diagnostics: [`dht.lookup: DHT entry for ${siteId} is malformed`],
        },
        exitCode: 1,
        summary: `[dht.lookup] malformed DHT entry for ${siteId}`,
        nextSteps: [
          {
            action: `The DHT entry for ${siteId} is malformed — re-register the site with dht.register`,
            kind: "required",
          },
        ],
      };
    }

    // 6. Verify entry signature
    let signatureValid = false;
    try {
      signatureValid = await verifyDhtEntry(entry, identity.operatorKeyPair.publicKeyMultibase);
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      return {
        data: {
          found: true,
          entry,
          hops: 0,
          latencyMs: Date.now() - startTime,
          cached: false,
          signatureValid: false,
          diagnostics: [`dht.lookup: DHT entry for ${siteId} has invalid signature — rejected`],
        },
        exitCode: 1,
        summary: `[dht.lookup] invalid signature for ${siteId}`,
        nextSteps: [
          {
            action: `The DHT entry for ${siteId} has an invalid signature — re-register the site with dht.register`,
            kind: "required",
          },
        ],
      };
    }

    // 7. Check if workshop is alive (SWIM integration)
    const alive = await isWorkshopAlive(workspaceRoot, entry.workshopEndpoint);
    if (!alive) {
      return {
        data: {
          found: false,
          entry: null,
          hops: 0,
          latencyMs: Date.now() - startTime,
          cached: false,
          signatureValid: true,
          diagnostics: [
            `dht.lookup: workshop ${entry.workshopEndpoint} is dead (SWIM) — routing around`,
          ],
        },
        exitCode: 0,
        summary: `[dht.lookup] workshop dead, routing around ${siteId}`,
      };
    }

    // 8. Cache the result
    await setCachedEntry(workspaceRoot, siteId, entry, config.cacheTtlMs);

    return {
      data: {
        found: true,
        entry,
        hops: 0,
        latencyMs: Date.now() - startTime,
        cached: false,
        signatureValid: true,
      },
      exitCode: 0,
      summary: `[dht.lookup] found ${siteId} at ${entry.workshopEndpoint}`,
    };
  } finally {
    await stopDhtNode(node);
  }
}
