/*
<MODULE_CONTRACT>
<purpose>RFC-0354 §7.4: sternsystem.pin — write or update system.pin.json for a Sternsystem.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0354: initial pin command handler.</item>
  <item>RFC-0381: use shared pin-helpers for highestRfcId and snapshotCapabilities; case-insensitive RFC regex.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { systemPinSchema, type SystemPin } from "@warpgogol/werkstatt-engine/schemas";
import { resolveCurrentEcosystem, resolvePlatformSemanticHash } from "../handoff/bundle-io.ts";
import { allMigratorIds } from "../migrators/registry.ts";
import {
  readSystemConfigSmart,
  writeSystemConfigSmart,
  resolveCacheClonePath,
} from "./registry-io.ts";
import { highestRfcId, snapshotCapabilities } from "./pin-helpers.ts";

export interface SternsystemPinData {
  systemId: string;
  platform: string;
  pinPath: string;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPat] = a.split(".").map(Number);
  const [bMaj, bMin, bPat] = b.split(".").map(Number);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

export async function runSternsystemPin(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemPinData>> {
  const { workspaceRoot, logger } = context;

  const id = flagString(input, "id");
  if (!id) throw new Error("[sternsystem.pin] requires --id <system-id>");

  const config = await readSystemConfigSmart(workspaceRoot, id);

  const cacheDir = resolveCacheClonePath(workspaceRoot, id);
  if (!existsSync(cacheDir)) {
    throw new Error(
      `[sternsystem.pin] cache clone for '${id}' is absent — run sternsystem.register first`,
    );
  }

  const requestedPlatform = flagString(input, "platform");

  // Check for downgrade if a pin already exists
  const pinPath = path.join(cacheDir, "system.pin.json");
  if (existsSync(pinPath) && requestedPlatform) {
    try {
      const raw = await fs.readFile(pinPath, "utf8");
      const existing = systemPinSchema.parse(JSON.parse(raw)) as SystemPin;
      if (compareSemver(requestedPlatform, existing.platform.version) < 0) {
        throw new Error(
          `[sternsystem.pin] requested platform ${requestedPlatform} is older than current pin ${existing.platform.version} — a site is never downgraded`,
        );
      }
    } catch (err) {
      if ((err as Error).message.includes("never downgraded")) throw err;
    }
  }

  const platform = requestedPlatform ?? (await resolveCurrentEcosystem(workspaceRoot)).version;
  const { commit } = await resolveCurrentEcosystem(workspaceRoot);
  const rfcHead = await highestRfcId(workspaceRoot);
  const platformSemanticHash = await resolvePlatformSemanticHash(workspaceRoot);
  const capabilities = await snapshotCapabilities(workspaceRoot);

  const pin: SystemPin = {
    schemaVersion: "1.0.0",
    systemId: id,
    cosmicStar: config.cosmicStar,
    pinnedAt: new Date().toISOString(),
    platform: {
      version: platform,
      commit: commit === "unknown" ? "0000000" : commit,
      rfcHead,
      platformSemanticHash,
    },
    migratorCursor: allMigratorIds(),
    capabilities,
  };

  systemPinSchema.parse(pin);
  await atomicWriteFile(pinPath, JSON.stringify(pin, null, 2) + "\n");

  // Update config: always activate on pin, update pinnedPlatform if changed
  let configChanged = false;
  if (config.pinnedPlatform !== platform) {
    config.pinnedPlatform = platform;
    configChanged = true;
  }
  if (config.status === "registered") {
    config.status = "active";
    configChanged = true;
  }
  if (configChanged) {
    await writeSystemConfigSmart(workspaceRoot, id, config);
  }

  logger.success(`[sternsystem.pin] pinned '${id}' to platform ${platform} (${rfcHead})`);
  return {
    data: { systemId: id, platform, pinPath },
    summary: `[sternsystem.pin] ${id} pinned to platform ${platform}`,
  };
}
