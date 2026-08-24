/*
<MODULE_CONTRACT>
<purpose>RFC-0221: filesystem IO for a handoff bundle — read/parse the lock and manifest,
hash files, and resolve the recipient's current ecosystem facts.</purpose>
<non-goals>
  <item>Do not copy or regenerate site files — that is pack/absorb's job.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial bundle IO helpers.</item>
  <item>RFC-0533: extend resolvePlatformSemanticHash to cover packages/, integrations/, and services/ (full platform scope).</item>
</CHANGE_SUMMARY>
*/

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  handoffLockSchema,
  handoffManifestSchema,
  type HandoffLock,
  type HandoffManifest,
} from "@warpgogol/werkstatt-engine/schemas";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
import { resolvePlatformSemanticHash } from "@warpgogol/werkstatt-engine/kernel";
import type { RegistryView } from "./types.ts";
import type { ValidationPack } from "./validation-pack.ts";

export { resolvePlatformSemanticHash };

const execFileAsync = promisify(execFile);

export function sha256OfBytes(bytes: Buffer | string): string {
  return byteHash(bytes);
}

export async function hashFile(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return sha256OfBytes(bytes);
}

export async function readLock(bundleDir: string): Promise<HandoffLock> {
  const raw = await fs.readFile(path.join(bundleDir, "handoff-lock.json"), "utf8");
  return handoffLockSchema.parse(JSON.parse(raw));
}

export async function readManifest(bundleDir: string): Promise<HandoffManifest> {
  const raw = await fs.readFile(path.join(bundleDir, "handoff-manifest.json"), "utf8");
  return handoffManifestSchema.parse(JSON.parse(raw));
}

/** Read the bundle's golden validation pack (validation/pack.json), or null if absent. */
export async function readGoldenPack(bundleDir: string): Promise<ValidationPack | null> {
  try {
    const raw = await fs.readFile(path.join(bundleDir, "validation", "pack.json"), "utf8");
    return JSON.parse(raw) as ValidationPack;
  } catch {
    return null;
  }
}

export interface CurrentEcosystem {
  version: string;
  commit: string;
}

/** Resolve the recipient's current ecosystem version (root package.json) and git SHA. */
export async function resolveCurrentEcosystem(workspaceRoot: string): Promise<CurrentEcosystem> {
  const pkgRaw = await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8");
  const version = String((JSON.parse(pkgRaw) as { version?: string }).version ?? "0.0.0");
  let commit = "unknown";
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceRoot,
    });
    commit = stdout.trim();
  } catch {
    // not a git checkout — leave "unknown"
  }
  return { version, commit };
}

/**
 * Legacy byte hash of the recipient's packages/ tree.
 *
 * Uses the committed git tree object id of `packages/` (cheap and deterministic),
 * wrapped as sha256 to satisfy the lock schema. Reflects COMMITTED state only — an
 * uncommitted local edit to packages/ is exactly the "ecosystem drift" the in-sync
 * branch warns about. Falls back to "sha256:" + 64 zeros when git is unavailable.
 *
 * RFC-0364: superseded by resolvePlatformSemanticHash for new writers.
 * Retained for dual-read during migration.
 */
export async function resolvePackagesHash(workspaceRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD:packages"], {
      cwd: workspaceRoot,
    });
    return sha256OfBytes(stdout.trim());
  } catch {
    return `sha256:${"0".repeat(64)}`;
  }
}

interface UniRegistryEntry {
  id: string;
  semanticId?: string;
  version: string;
  intent?: string[];
}

/** Build a RegistryView keyed by the unique entry id (semanticId is not unique across layers). */
export async function readRegistryView(workspaceRoot: string): Promise<RegistryView> {
  const raw = await fs.readFile(path.join(workspaceRoot, "uni.registry.yaml"), "utf8");
  const parsed = JSON.parse(raw) as { entries?: UniRegistryEntry[] };
  const byId = new Map<string, { version: string; semanticId: string; intent: string[] }>();
  for (const entry of parsed.entries ?? []) {
    if (!entry.id) continue;
    byId.set(entry.id, {
      version: entry.version ?? "0.0.0",
      semanticId: entry.semanticId ?? entry.id,
      intent: entry.intent ?? [],
    });
  }
  return { byId };
}
