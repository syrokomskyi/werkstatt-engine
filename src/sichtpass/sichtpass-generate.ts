/*
<MODULE_CONTRACT>
<purpose>RFC-0947: sichtpass.generate command handler — produces a site-wide visibility snapshot with deduplication.</purpose>
<keywords>sichtpass, visibility, snapshot, bordbuch, deduplication, composite hash</keywords>
<responsibilities>
  <item>Reads contributing data sources: content-regression snapshot, behavior snapshot, nachweis manifest, system-state, system-config, bordbuch status, coverage ledger.</item>
  <item>Computes a composite hash via snapshotCanonicalJsonObjectV1 + canonicalJsonHashV1, excluding deployedAt timestamps.</item>
  <item>Appends a sichtpass Bordbuch entry with slug __site__ when composite hash differs from the last sichtpass entry.</item>
  <item>Deduplicates: skips Bordbuch append when composite hash is unchanged.</item>
  <item>Handles missing data sources gracefully (null/0/empty array, log warning).</item>
  <item>Handles Bordbuch read/append failures as fail-open (non-fatal, warning in summary).</item>
  <item>Acquires system and bordbuch locks during Bordbuch operations.</item>
</responsibilities>
<non-goals>
  <item>Does not define W3C Verifiable Credential issuance.</item>
  <item>Does not build a UI for the Sichtpass.</item>
  <item>Does not change the Bordbuch hash-chain algorithm or NDJSON format.</item>
  <item>Does not retroactively clean up existing duplicate sichtpass events.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0947: initial sichtpass.generate command handler.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  snapshotCanonicalJsonObjectV1,
  canonicalJsonHashV1,
} from "@warpgogol/werkstatt-engine/fingerprint";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import {
  resolveCacheClonePath,
  resolveActiveWorkpieceDir,
  readSystemState,
  readSystemConfig,
} from "../sternsystem/registry-io.ts";
import { resolveNachweisCachePath } from "../nachweis/nachweis-io.ts";
import type {
  SichtpassSiteSnapshot,
  SichtpassBordbuchMetadata,
  SichtpassChannelState,
  SichtpassPseoModule,
} from "./sichtpass-snapshot.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

interface ContentRegressionSnapshotData {
  contentHash: string | null;
  routeCount: number;
}

interface BehaviorSnapshotData {
  routeCount: number;
}

interface NachweisManifestData {
  count: number;
  slugs: string[];
}

interface SystemStateData {
  releaseId: string | null;
  channels: {
    dev: SichtpassChannelState;
    alt: SichtpassChannelState;
    main: SichtpassChannelState;
  };
}

interface PseoModulesData {
  modules: SichtpassPseoModule[];
}

interface CoverageLedgerData {
  atoms: number;
  pages: string[];
}

async function readContentRegressionSnapshot(
  cachePath: string,
  _systemId: string,
): Promise<ContentRegressionSnapshotData> {
  const snapshotDir = path.join(cachePath, ".cache", "content-regression");
  if (!existsSync(snapshotDir)) {
    return { contentHash: null, routeCount: 0 };
  }
  try {
    const files = await fs.readdir(snapshotDir);
    const snapshotFile = files.find((f) => f.endsWith(".snapshot.yaml"));
    if (!snapshotFile) {
      return { contentHash: null, routeCount: 0 };
    }
    const raw = await fs.readFile(path.join(snapshotDir, snapshotFile), "utf8");
    const parsed = parseYaml(raw) as {
      contentHash?: string;
      routes?: unknown[];
    };
    return {
      contentHash: typeof parsed.contentHash === "string" ? parsed.contentHash : null,
      routeCount: Array.isArray(parsed.routes) ? parsed.routes.length : 0,
    };
  } catch {
    return { contentHash: null, routeCount: 0 };
  }
}

async function readBehaviorSnapshot(cachePath: string): Promise<BehaviorSnapshotData> {
  const filePath = path.join(cachePath, "behavior.snapshot.generated.yaml");
  if (!existsSync(filePath)) {
    return { routeCount: 0 };
  }
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = parseYaml(raw) as { routes?: unknown[] };
    return {
      routeCount: Array.isArray(parsed.routes) ? parsed.routes.length : 0,
    };
  } catch {
    return { routeCount: 0 };
  }
}

async function readNachweisManifest(
  workspaceRoot: string,
  systemId: string,
): Promise<NachweisManifestData> {
  try {
    const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
    const manifestPath = path.join(cachePath, "public", "nachweise", "manifest.json");
    if (!existsSync(manifestPath)) {
      return { count: 0, slugs: [] };
    }
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as { records?: Array<{ slug?: string }> };
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    return {
      count: records.length,
      slugs: records.map((r) => r.slug).filter((s): s is string => typeof s === "string"),
    };
  } catch {
    return { count: 0, slugs: [] };
  }
}

async function readSystemStateData(
  workspaceRoot: string,
  systemId: string,
): Promise<SystemStateData> {
  try {
    const state = await readSystemState(workspaceRoot, systemId);
    const config = await readSystemConfig(workspaceRoot, systemId);
    const channels = config.deployment?.channels;
    const lastProp = state.lastPropagated;
    const makeChannel = (
      ch: { url: string; workerName: string } | undefined,
      prop: { releaseId: string; healthy: boolean; at: string } | undefined,
    ): SichtpassChannelState => ({
      healthy: prop?.healthy ?? false,
      releaseId: prop?.releaseId ?? null,
      deployedAt: prop?.at ?? null,
    });
    return {
      releaseId: state.lastRelease,
      channels: {
        dev: makeChannel(channels?.dev, lastProp.dev),
        alt: makeChannel(channels?.alt, lastProp.alt),
        main: makeChannel(channels?.main, lastProp.main),
      },
    };
  } catch {
    return {
      releaseId: null,
      channels: {
        dev: { healthy: false, releaseId: null, deployedAt: null },
        alt: { healthy: false, releaseId: null, deployedAt: null },
        main: { healthy: false, releaseId: null, deployedAt: null },
      },
    };
  }
}

async function readPseoModules(cachePath: string): Promise<PseoModulesData> {
  const statusPath = path.join(cachePath, "bordbuch", "status.generated.yaml");
  if (!existsSync(statusPath)) {
    return { modules: [] };
  }
  try {
    const raw = await fs.readFile(statusPath, "utf8");
    const parsed = parseYaml(raw) as {
      pseo?: {
        modules?: Array<{
          id: string;
          masterLocale: string;
          publishedLocales?: string[];
        }>;
      };
    };
    const modules = parsed.pseo?.modules ?? [];
    return {
      modules: modules.map((m) => ({
        id: m.id,
        masterLocale: m.masterLocale,
        publishedLocales: Array.isArray(m.publishedLocales) ? m.publishedLocales : [],
      })),
    };
  } catch {
    return { modules: [] };
  }
}

async function readCoverageLedger(cachePath: string): Promise<CoverageLedgerData> {
  const ledgerPath = path.join(cachePath, "provenance", "coverage-ledger.yaml");
  if (!existsSync(ledgerPath)) {
    return { atoms: 0, pages: [] };
  }
  try {
    const raw = await fs.readFile(ledgerPath, "utf8");
    const parsed = parseYaml(raw) as {
      atoms?: Array<{ pageId?: string; supersededBy?: string }>;
    };
    const atoms = Array.isArray(parsed.atoms) ? parsed.atoms : [];
    const activeAtoms = atoms.filter((a) => !a.supersededBy);
    const pageSet = new Set<string>();
    for (const a of activeAtoms) {
      if (typeof a.pageId === "string" && a.pageId) {
        pageSet.add(a.pageId);
      }
    }
    return {
      atoms: activeAtoms.length,
      pages: [...pageSet].sort(),
    };
  } catch {
    return { atoms: 0, pages: [] };
  }
}

function computeCompositeHash(snapshot: Omit<SichtpassSiteSnapshot, "compositeHash">): string {
  const hashInput = {
    schemaVersion: snapshot.schemaVersion,
    systemId: snapshot.systemId,
    contentHash: snapshot.contentHash,
    routeCount: snapshot.routeCount,
    behaviorRouteCount: snapshot.behaviorRouteCount,
    nachweisCount: snapshot.nachweisCount,
    nachweisSlugs: snapshot.nachweisSlugs,
    releaseId: snapshot.releaseId,
    channels: {
      dev: {
        healthy: snapshot.channels.dev.healthy,
        releaseId: snapshot.channels.dev.releaseId,
      },
      alt: {
        healthy: snapshot.channels.alt.healthy,
        releaseId: snapshot.channels.alt.releaseId,
      },
      main: {
        healthy: snapshot.channels.main.healthy,
        releaseId: snapshot.channels.main.releaseId,
      },
    },
    pseoModules: snapshot.pseoModules,
    coverageAtoms: snapshot.coverageAtoms,
    coveragePages: snapshot.coveragePages,
  };
  const snapshotResult = snapshotCanonicalJsonObjectV1(hashInput);
  if (!snapshotResult.ok) {
    throw new Error(`[sichtpass.generate] canonical JSON snapshot failed: ${snapshotResult.code}`);
  }
  return canonicalJsonHashV1(snapshotResult.value);
}

function findLastSichtpassSiteEntry(entries: BordbuchEntry[]): BordbuchEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.kind !== "sichtpass") continue;
    const meta = entry.metadata as Record<string, unknown> | undefined;
    if (meta?.slug === "__site__") return entry;
  }
  return null;
}

export async function runSichtpassGenerate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;

  if (!systemId) throw new Error("[sichtpass.generate] --system is required");

  // Resolve workpiece-aware cache path for content/behavior/nachweis data
  const workpieceDir = await resolveActiveWorkpieceDir(workspaceRoot, systemId);
  const contentCachePath = workpieceDir ?? (await resolveCacheClonePath(workspaceRoot, systemId));
  const cacheClonePath = await resolveCacheClonePath(workspaceRoot, systemId);

  // Read all data sources
  const [contentRegression, behavior, nachweis, systemStateData, pseoModules, coverageLedger] =
    await Promise.all([
      readContentRegressionSnapshot(contentCachePath, systemId),
      readBehaviorSnapshot(contentCachePath),
      readNachweisManifest(workspaceRoot, systemId),
      readSystemStateData(workspaceRoot, systemId),
      readPseoModules(cacheClonePath),
      readCoverageLedger(cacheClonePath),
    ]);

  // Log warnings for missing data sources
  if (contentRegression.contentHash === null) {
    logger.warn(
      "[sichtpass.generate] content-regression snapshot not found — contentHash will be null",
    );
  }
  if (behavior.routeCount === 0) {
    logger.warn(
      "[sichtpass.generate] behavior snapshot not found or empty — behaviorRouteCount will be 0",
    );
  }
  if (nachweis.count === 0) {
    logger.info("[sichtpass.generate] no published nachweis records found");
  }

  // Build snapshot without compositeHash first
  const snapshotBase: Omit<SichtpassSiteSnapshot, "compositeHash"> = {
    schemaVersion: "1.0.0",
    systemId,
    generatedAt: null,
    contentHash: contentRegression.contentHash,
    routeCount: contentRegression.routeCount,
    behaviorRouteCount: behavior.routeCount,
    nachweisCount: nachweis.count,
    nachweisSlugs: nachweis.slugs,
    releaseId: systemStateData.releaseId,
    channels: systemStateData.channels,
    pseoModules: pseoModules.modules,
    coverageAtoms: coverageLedger.atoms,
    coveragePages: coverageLedger.pages,
  };

  const compositeHash = computeCompositeHash(snapshotBase);
  const snapshot: SichtpassSiteSnapshot = {
    ...snapshotBase,
    compositeHash,
  };

  // Deduplication: read last sichtpass __site__ entry and compare compositeHash
  let deduplicated = false;
  let bordbuchWarning: string | null = null;

  try {
    const entries = await readBordbuch(workspaceRoot, systemId);
    const lastSiteEntry = findLastSichtpassSiteEntry(entries);
    if (lastSiteEntry) {
      const lastMeta = lastSiteEntry.metadata as Record<string, unknown> | undefined;
      const lastHash = typeof lastMeta?.recordHash === "string" ? lastMeta.recordHash : null;
      if (lastHash === compositeHash) {
        deduplicated = true;
        logger.info(
          `[sichtpass.generate] composite hash unchanged (${compositeHash.slice(0, 16)}...) — skipping Bordbuch append`,
        );
      }
    }
  } catch (err) {
    bordbuchWarning = `Bordbuch read failed: ${(err as Error).message}`;
    logger.warn(`[sichtpass.generate] ${bordbuchWarning} — proceeding with append`);
  }

  // Append Bordbuch entry if not deduplicated
  if (!deduplicated) {
    const operationId = generateOperationId();
    await acquireLock(
      workspaceRoot,
      `system:${systemId}`,
      operationId,
      "sichtpass.generate",
      "agent",
    );
    await acquireLock(
      workspaceRoot,
      `bordbuch:${systemId}`,
      operationId,
      "sichtpass.generate",
      "agent",
    );
    try {
      const metadata: SichtpassBordbuchMetadata = {
        slug: "__site__",
        manifestVersion: "1.0.0",
        recordHash: compositeHash,
        signaturePresent: false,
        timestampPresent: false,
        verificationLevel: "N0",
        contentHash: snapshot.contentHash ?? undefined,
        routeCount: snapshot.routeCount,
        nachweisCount: snapshot.nachweisCount,
        releaseId: snapshot.releaseId,
        channelHealth: {
          dev: snapshot.channels.dev.healthy,
          alt: snapshot.channels.alt.healthy,
          main: snapshot.channels.main.healthy,
        },
      };

      await appendAndCommitBordbuch(
        workspaceRoot,
        systemId,
        "sichtpass",
        `Sichtpass site visibility snapshot for '${systemId}'`,
        "agent",
        {
          writerRole: "nachweis",
          metadata: metadata as unknown as Record<string, unknown>,
        },
        `Bordbuch: sichtpass ${systemId} site-visibility-snapshot`,
      );
      logger.success(`[sichtpass.generate] appended sichtpass __site__ entry for ${systemId}`);
    } catch (err) {
      bordbuchWarning = `Bordbuch append failed: ${(err as Error).message}`;
      logger.warn(`[sichtpass.generate] ${bordbuchWarning} — non-fatal`);
    } finally {
      await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
      await releaseLock(workspaceRoot, `system:${systemId}`);
    }
  }

  const summaryParts = [
    `[sichtpass.generate] ${systemId}: compositeHash=${compositeHash.slice(0, 16)}...`,
    `routes=${snapshot.routeCount}`,
    `nachweis=${snapshot.nachweisCount}`,
    `pseo=${snapshot.pseoModules.length}`,
  ];
  if (deduplicated) {
    summaryParts.push("deduplicated=true");
  }
  if (bordbuchWarning) {
    summaryParts.push(`warning=${bordbuchWarning}`);
  }

  return {
    data: snapshot,
    exitCode: 0,
    summary: summaryParts.join(", "),
  };
}
