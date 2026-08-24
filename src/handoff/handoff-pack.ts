/*
<MODULE_CONTRACT>
<purpose>RFC-0221: `handoff.pack` — produce a thin, version-stamped site bundle for internal
transfer. Carries the authored site only (content + whitelisted config) plus provenance, lock,
and an authored/derived manifest. No packages/, node_modules/, dist/, or *.generated.* files.</purpose>
<non-goals>
  <item>Do not copy packages/, node_modules/, dist/, or any *.generated.* file.</item>
  <item>Do not mutate the source workspace — pack is read-only on the source.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial thin-bundle packer.</item>
  <item>RFC-0221: Compass-complete authored partition (consumed-subset capability narrowing is follow-up).</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import {
  handoffLockSchema,
  handoffManifestSchema,
  type HandoffCapability,
  type HandoffManifestEntry,
} from "@warpgogol/werkstatt-engine/schemas";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  hashFile,
  resolveCurrentEcosystem,
  resolvePackagesHash,
  resolvePlatformSemanticHash,
} from "./bundle-io.ts";
import { allMigratorIds } from "../migrators/registry.ts";
import { resolveAuthoredFiles } from "./authored-set.ts";
import { buildValidationPack } from "./validation-pack.ts";

const LOCK_SCHEMA_VERSION = "1.0.0";
const ZERO_HASH = `sha256:${"0".repeat(64)}`;

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await rec(abs);
      else out.push(abs);
    }
  }
  await rec(root);
  return out;
}

async function highestRfcId(workspaceRoot: string): Promise<string> {
  try {
    const files = await fs.readdir(path.join(workspaceRoot, "docs", "rfcs"));
    let max = 0;
    for (const f of files) {
      const m = /^RFC-(\d{4})/.exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `RFC-${String(max).padStart(4, "0")}`;
  } catch {
    return "RFC-0000";
  }
}

/**
 * Snapshot consumed capabilities. Foundation slice: conservatively snapshots the whole
 * uni.registry component surface (over-inclusion is safe for the diff — unused entries
 * stay green). Narrowing to the app's resolved component graph is a follow-up.
 */
async function snapshotCapabilities(workspaceRoot: string): Promise<HandoffCapability[]> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, "uni.registry.yaml"), "utf8");
    const parsed = JSON.parse(raw) as {
      entries?: { id: string; semanticId?: string; version: string; intent?: string[] }[];
    };
    return (parsed.entries ?? [])
      .filter((e) => e.id)
      .map((e) => ({
        id: e.id,
        semanticId: e.semanticId ?? e.id,
        version: e.version ?? "0.0.0",
        intent: e.intent ?? [],
      }));
  } catch {
    return [];
  }
}

export interface HandoffPackData {
  bundleDir: string;
  site: string;
  fileCount: number;
}

function resolveSiteName(input: KernelCommandInput): string {
  const flag = input.flags["site"];
  const raw = typeof flag === "string" ? flag : undefined;
  if (!raw) {
    throw new Error("[handoff.pack] requires the site name — use --site <name>");
  }
  return raw;
}

export async function runHandoffPack(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<HandoffPackData>> {
  const { workspaceRoot, logger, dryRun } = context;
  const siteName = resolveSiteName(input);

  const sourceSiteDir = path.resolve(workspaceRoot, "apps", siteName);
  try {
    await fs.stat(sourceSiteDir);
  } catch {
    throw new Error(`[handoff.pack] no site at apps/${siteName}`);
  }
  const bundleDir = path.resolve(workspaceRoot, "..", "handoff", siteName);
  const siteDir = path.join(bundleDir, "site");

  const [{ version, commit }, platformSemanticHash, packagesHash, rfcHead, capabilities] =
    await Promise.all([
      resolveCurrentEcosystem(workspaceRoot),
      resolvePlatformSemanticHash(workspaceRoot),
      resolvePackagesHash(workspaceRoot),
      highestRfcId(workspaceRoot),
      snapshotCapabilities(workspaceRoot),
    ]);

  // Build provenance facts from the passport when available.
  let systemHash = ZERO_HASH;
  let buildCommit = commit === "unknown" ? "0000000" : commit;
  try {
    const passportRaw = await fs.readFile(
      path.join(sourceSiteDir, "dist", ".well-known", "cosmic-passport.json"),
      "utf8",
    );
    const passport = JSON.parse(passportRaw) as {
      composition?: { systemHash?: string };
      provenance?: { commitSha?: string };
    };
    if (passport.composition?.systemHash) systemHash = passport.composition.systemHash;
    if (passport.provenance?.commitSha) buildCommit = passport.provenance.commitSha;
  } catch {
    // no passport built — provenance falls back to placeholders
  }

  const lock = handoffLockSchema.parse({
    schemaVersion: LOCK_SCHEMA_VERSION,
    site: siteName,
    packedAt: new Date().toISOString(),
    ecosystem: {
      version,
      commit: commit === "unknown" ? "0000000" : commit,
      rfcHead,
      platformSemanticHash,
      packagesHash,
    },
    migratorCursor: allMigratorIds(),
    capabilities,
    build: { systemHash, commitSha: buildCommit },
  });

  // Compass-complete authored partition: what travels (source of truth) vs what regen re-derives.
  const partition = await resolveAuthoredFiles(workspaceRoot, siteName, input);

  logger.section("[handoff.pack] plan");
  logger.info(`App:    ${siteName}`);
  logger.info(`Target: ${bundleDir}`);
  logger.info(`Stamp:  ecosystem ${version} | ${rfcHead} | ${capabilities.length} capabilities`);
  logger.info(
    `Partition: ${partition.authored.length} authored, ${partition.excluded.length} excluded (regenerated)`,
  );

  if (dryRun) {
    return {
      data: { bundleDir, site: siteName, fileCount: partition.authored.length },
      summary: `[handoff.pack] dry-run — would pack ${partition.authored.length} authored file(s) for ${siteName} → ${bundleDir}`,
    };
  }

  // Clear and rebuild the bundle (preserve .git so a per-client repo survives).
  try {
    for (const entry of await fs.readdir(bundleDir)) {
      if (entry === ".git") continue;
      await fs.rm(path.join(bundleDir, entry), { recursive: true, force: true });
    }
  } catch {
    await fs.mkdir(bundleDir, { recursive: true });
  }
  await fs.mkdir(siteDir, { recursive: true });

  // Copy the Compass-complete authored partition (one file at a time).
  for (const rel of partition.authored) {
    const src = path.join(sourceSiteDir, rel);
    const dest = path.join(siteDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }

  // Snapshot provenance.
  const provDir = path.join(bundleDir, "provenance");
  await fs.mkdir(provDir, { recursive: true });
  for (const [from, to] of [
    [
      path.join(sourceSiteDir, "dist", ".well-known", "cosmic-passport.json"),
      "cosmic-passport.json",
    ],
    [path.join(sourceSiteDir, "provenance", "coverage-ledger.yaml"), "coverage-ledger.yaml"],
  ] as const) {
    try {
      await fs.copyFile(from, path.join(provDir, to));
    } catch {
      /* absent — skip */
    }
  }

  // Golden validation pack — significant properties of the last build (for absorb to diff against).
  const validationDir = path.join(bundleDir, "validation");
  await fs.mkdir(validationDir, { recursive: true });
  const golden = await buildValidationPack(sourceSiteDir);
  await fs.writeFile(
    path.join(validationDir, "pack.json"),
    `${JSON.stringify(golden, null, 2)}\n`,
    "utf8",
  );
  try {
    const outDir = await fs
      .stat(path.join(sourceSiteDir, "dist", "client"))
      .then(() => "dist/client")
      .catch(() => "dist");
    await fs.copyFile(
      path.join(sourceSiteDir, outDir, "sitemap.xml"),
      path.join(validationDir, "sitemap.snapshot.xml"),
    );
  } catch {
    /* no sitemap — skip snapshot */
  }
  if (golden.empty) {
    logger.warn("[handoff.pack] no build output (dist/) — golden validation pack is empty");
  } else {
    logger.info(
      `Validation: ${golden.routes.length} routes, scores ${golden.scores ? "captured" : "absent"}`,
    );
  }

  // Build the manifest over everything actually placed in site/.
  const siteFiles = await walkFiles(siteDir);
  const entries: HandoffManifestEntry[] = [];
  for (const abs of siteFiles) {
    const rel = path.relative(bundleDir, abs).replace(/\\/g, "/");
    entries.push({ path: rel, kind: "authored", hash: await hashFile(abs) });
  }
  const manifest = handoffManifestSchema.parse({
    schemaVersion: LOCK_SCHEMA_VERSION,
    site: siteName,
    entries,
  });

  await fs.writeFile(
    path.join(bundleDir, "handoff-lock.json"),
    `${JSON.stringify(lock, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(bundleDir, "handoff-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  logger.success(`[handoff.pack] packed ${entries.length} authored file(s) → ${bundleDir}`);
  return {
    data: { bundleDir, site: siteName, fileCount: entries.length },
    summary: `[handoff.pack] ${siteName}: ${entries.length} authored files → ${bundleDir}`,
    nextSteps: [
      {
        action: `Validate the bundle: pnpm exec werkstatt run handoff.validate --bundle ${bundleDir}`,
        kind: "optional",
      },
    ],
  };
}
