/*
<MODULE_CONTRACT>
<purpose>RFC-0221: `handoff.absorb` — version-aware ingest. Builds the catch-up report (version
compare + migrator chain + capability diff + tiered report), refuses downgrades, then materializes:
apply migrators → inject the authored set into apps/&lt;target&gt; → delegate regeneration + validation
to build.prepare/build.check. Red-tier requires --force; --report-only stops before any write.</purpose>
<non-goals>
  <item>Do not git-merge the bundle. Do not round-trip generated files as source of truth.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: report-only path + downgrade gate.</item>
  <item>RFC-0221: materialization write-path — inject (migrators applied) + delegated regen; --as/--regen/--force.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import fs from "node:fs/promises";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { buildCatchupReport } from "./absorb-report.ts";
import {
  readGoldenPack,
  readLock,
  readManifest,
  readRegistryView,
  resolveCurrentEcosystem,
  resolvePackagesHash,
  resolvePlatformSemanticHash,
} from "./bundle-io.ts";
import { injectAuthoredSet, loadAuthoredSet, runRegeneration } from "./materialize.ts";
import { buildValidationPack, diffValidationPacks } from "./validation-pack.ts";
import { reportDerivedEdits } from "./derived-edits.ts";
import type { CatchupReport } from "./types.ts";

export interface HandoffAbsorbData {
  bundleDir: string;
  report: CatchupReport;
  materialized: boolean;
  targetApp?: string;
  filesInjected?: number;
  regenerated?: boolean;
  validationClean?: boolean;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function resolveBundleDir(input: KernelCommandInput, workspaceRoot: string): string {
  const flag = input.flags["bundle"];
  const raw = typeof flag === "string" ? flag : undefined;
  if (!raw) throw new Error("[handoff.absorb] requires --bundle <path>");
  return path.resolve(workspaceRoot, raw);
}

function printReport(report: CatchupReport, logger: KernelRuntimeContext["logger"]): void {
  logger.section(`[handoff.absorb] catch-up report — ${report.app}`);
  logger.info(report.comparison.message);
  logger.info(`Overall tier: ${report.overallTier.toUpperCase()}`);

  if (report.migratorChain.length > 0) {
    logger.info(`Migrator chain (${report.migratorChain.length}):`);
    for (const m of report.migratorChain) {
      logger.info(`  ${m.id}: ${m.description}`);
    }
  }

  for (const d of report.capabilityDiff) {
    if (d.change === "unchanged") continue;
    const mark = d.tier === "red" ? "✗" : d.tier === "yellow" ? "~" : "+";
    logger.info(`  ${mark} ${d.id}: ${d.note}`);
  }
}

export async function runHandoffAbsorb(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<HandoffAbsorbData>> {
  const { workspaceRoot, logger } = context;
  const bundleDir = resolveBundleDir(input, workspaceRoot);
  const reportOnly = input.flags["report-only"] === true;
  const regen = input.flags["regen"] === true;
  const force = input.flags["force"] === true;
  const asFlag = input.flags["as"];

  const lock = await readLock(bundleDir);
  const [{ version: currentVersion }, currentPackagesHash, currentPlatformSemanticHash, registry] =
    await Promise.all([
      resolveCurrentEcosystem(workspaceRoot),
      resolvePackagesHash(workspaceRoot),
      resolvePlatformSemanticHash(workspaceRoot),
      readRegistryView(workspaceRoot),
    ]);

  const report = buildCatchupReport({
    lock,
    currentVersion,
    currentPackagesHash,
    currentPlatformSemanticHash,
    registry,
  });
  printReport(report, logger);

  // Downgrade gate (RFC-0221 §4.1): never absorb a bundle from a newer ecosystem.
  if (report.comparison.verdict === "refuse-downgrade") {
    return {
      data: { bundleDir, report, materialized: false },
      exitCode: 1,
      summary: `[handoff.absorb] refused — ${report.comparison.message}`,
    };
  }

  if (reportOnly) {
    return {
      data: { bundleDir, report, materialized: false },
      summary: `[handoff.absorb] report-only — overall tier ${report.overallTier}`,
    };
  }

  // Red tier = manual migration decision (RFC-0221 §6). Do not auto-materialize without --force.
  if (report.overallTier === "red" && !force) {
    logger.error(
      "[handoff.absorb] overall tier is RED — manual migration decisions required (see report above). " +
        "Resolve them, or pass --force to materialize anyway.",
    );
    return {
      data: { bundleDir, report, materialized: false },
      exitCode: 1,
      summary: "[handoff.absorb] refused — red-tier decisions unresolved (use --force to override)",
    };
  }

  // ── Materialize: apply migrators → inject authored set → (delegate) regenerate ──
  const targetApp = typeof asFlag === "string" ? asFlag : lock.app;
  const targetDir = path.resolve(workspaceRoot, "apps", targetApp);
  const isNewApp = !(await pathExists(targetDir));

  const manifest = await readManifest(bundleDir);

  // Derived-edit detection (RFC-0221 §7): if any derived entry has a hash mismatch, raise it
  // as a red-tier decision record so hand edits are not lost.
  const derivedEdits = await reportDerivedEdits(bundleDir, manifest);
  if (derivedEdits.length > 0) {
    logger.warn("[handoff.absorb] derived-edit decision record:");
    for (const edit of derivedEdits) {
      logger.warn(
        `  ${edit.path}: hash mismatch (edited after packing). ` +
          `Expected ${edit.expectedHash.slice(0, 12)}…, got ${edit.actualHash ? edit.actualHash.slice(0, 12) + "…" : "MISSING"}.`,
      );
    }
    logger.error(
      "[handoff.absorb] regeneration will overwrite these edits. " +
        "Review them, resolve, or pass --force to regenerate anyway.",
    );
    return {
      data: { bundleDir, report, materialized: false },
      exitCode: 1,
      summary: `[handoff.absorb] refused — ${derivedEdits.length} derived-file edit(s) detected (use --force to overwrite)`,
    };
  }

  const loaded = await loadAuthoredSet(bundleDir, manifest);

  await fs.mkdir(targetDir, { recursive: true });
  const filesInjected = await injectAuthoredSet(targetDir, loaded);

  logger.section(`[handoff.absorb] materialize → apps/${targetApp}${isNewApp ? " (new app)" : ""}`);
  logger.info(
    `Injected ${filesInjected} authored file(s) (migrators applied: ${report.migratorChain.length})`,
  );

  if (!regen) {
    const steps = isNewApp
      ? `pnpm install && site-kernel pipeline build.prepare --site ${targetApp} && site-kernel pipeline build.check --site ${targetApp}`
      : `site-kernel pipeline build.prepare --site ${targetApp}`;
    logger.info(`[handoff.absorb] regeneration delegated — run: ${steps}`);
    return {
      data: { bundleDir, report, materialized: true, targetApp, filesInjected, regenerated: false },
      summary: `[handoff.absorb] materialized apps/${targetApp} (${filesInjected} files); regenerate with build.prepare${isNewApp ? " (after pnpm install)" : ""}`,
    };
  }

  // A brand-new app is not yet a resolved workspace member — install before building.
  const { installCode, prepareCode, checkCode } = await runRegeneration(workspaceRoot, targetApp, {
    install: isNewApp,
  });
  const regenerated = installCode === 0 && prepareCode === 0 && checkCode === 0;
  if (!regenerated) {
    return {
      data: { bundleDir, report, materialized: true, targetApp, filesInjected, regenerated: false },
      exitCode: 1,
      summary: `[handoff.absorb] materialized apps/${targetApp}, but regeneration/validation failed (install=${installCode}, prepare=${prepareCode}, check=${checkCode})`,
    };
  }

  logger.success(`[handoff.absorb] absorbed apps/${targetApp} — regenerated + validated`);

  // Golden-pack diff: confirm the rebuilt site preserved the bundle's significant properties.
  const validationClean = await reportGoldenDiff(bundleDir, targetDir, logger);

  return {
    data: {
      bundleDir,
      report,
      materialized: true,
      targetApp,
      filesInjected,
      regenerated: true,
      validationClean: validationClean ?? undefined,
    },
    summary: `[handoff.absorb] absorbed apps/${targetApp} — overall tier ${report.overallTier}${
      validationClean === false ? " (golden-pack drift — see report)" : ""
    }`,
    nextSteps: [
      {
        action: `Validate the site: pnpm exec werkstatt run mission.validate --mission <mission-id>`,
        kind: "optional",
      },
    ],
  };
}

/**
 * Diff the rebuilt site's significant properties against the bundle's golden pack.
 * Returns true (clean), false (drift), or null (skipped — no golden pack or no build output).
 */
async function reportGoldenDiff(
  bundleDir: string,
  targetDir: string,
  logger: KernelRuntimeContext["logger"],
): Promise<boolean | null> {
  const golden = await readGoldenPack(bundleDir);
  if (!golden || golden.empty) {
    logger.info("[handoff.absorb] no golden validation pack in bundle — skipping golden-pack diff");
    return null;
  }
  const fresh = await buildValidationPack(targetDir);
  if (fresh.empty) {
    logger.info("[handoff.absorb] no build output to validate — skipping golden-pack diff");
    return null;
  }

  const diff = diffValidationPacks(golden, fresh);
  if (diff.clean) {
    logger.success("[handoff.absorb] golden-pack diff clean — significant properties preserved");
    return true;
  }

  logger.warn("[handoff.absorb] golden-pack drift:");
  for (const r of diff.routesRemoved) logger.warn(`  - route removed: ${r}`);
  for (const r of diff.routesAdded) logger.warn(`  + route added: ${r}`);
  if (diff.sitemapChanged) logger.warn("  ~ sitemap.xml changed");
  for (const l of diff.llmsChanged) logger.warn(`  ~ ${l} changed`);
  for (const s of diff.scoreDeltas) logger.warn(`  ~ ${s.key}: ${s.from} → ${s.to}`);
  return false;
}
