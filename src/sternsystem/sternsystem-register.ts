/*
<MODULE_CONTRACT>
<purpose>RFC-0354 §7.1 + RFC-1307: sternsystem.register — add a new Sternsystem to the fleet
registry from a validated werkstatt:intake/v1 bundle: create pin, seed system.md, the
primary-locale business profile and publishable assets deterministically, record the
intake provenance, open the first mission, and trigger materialization.
With --amend: update pin and open amend mission without creating a new registry entry.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
  <item>Do not reimplement pin, mission.open, or mission.materialize logic — delegate to existing commands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <item>RFC-1293: require timing semantics on time-bound policy fields via contractTerms.gate (RFC-1293)

policySchema gains an optional timing map (pbpTimingSchema: startEvent, clock,
timezone, businessHours, boundary) inherited by every specialized policy.
pbp.content.validate sweeps each pbp/* entity's frontmatter — TIMED_FIELDS
registry paths plus every ISO-8601 duration literal — and emits
PBP-TIMING-01..04 at contractTerms.gate severity (warn|enforce in system.md;
absent = warn). enforce also makes pbp.terms-reference.validate behave as
--strict. New sites register with contractTerms.gate: enforce
(sternsystem-register stub + both onboarding system templates). Live warpgogol
run: 129 PBP-TIMING-01 warnings across policies/offerings/documents/claims —
the owner's contract-decision agenda; no timing values authored, no site gate
flipped. Known registry gap: renewal.renewalPeriod/reminder are not ISO-shaped
and escape the sweep (documented in the RFC evidence). Canary C10 active.</item>
  <item>RFC-1294: require verbatim source provenance for external local facts (RFC-1294)

localFacts[] entries gain sourceUrl/excerpt/excerptLang/scope/reviewedBy/
reviewedAt. surface.evidence.validate sweeps every blueprint dataset record's
localFacts once per source file and emits LOCALFACT-01 (missing
sourceUrl/excerpt), LOCALFACT-02 (off-host sourceUrl — dot-boundary subdomains
of the descriptor endpoint host pass), LOCALFACT-03 (normalized number absent
from the verbatim excerpt), LOCALFACT-04 (stale asOf+reviewEvery, always a
warning). systemManifestSchema gains provenance.gate (warn|enforce, absent =
warn; new sites register enforce). The bake renders 'Geprüfte lokale Fakten'
only when every rendered fact carries a human review record — otherwise the
neutral 'Lokaler Kontext' — plus a Quellen block listing each distinct
sourceUrl with its asOf date. Live warpgogol run: 40 LOCALFACT-01 warnings
across the 12 city demand records — the owner's research backlog; no excerpts,
review records, or gate flips authored. Canary C11 active.</item>
  <item>RFC-1307: steps 3-4 — deterministic intake seed planner and sternsystem.register --intake --biome</item>
  <item>RFC-1307: canonical org-singleton PBP paths, seeded hreflang+publication.gate, full rollback</item>
  <history>RFC-0354, RFC-0532, RFC-0561, RFC-0902, RFC-1149</history>
</CHANGE_SUMMARY>
*/

import { isAbsolute, join, resolve } from "node:path";
import { cacheCloneCommit } from "../mission/mission-git-commit.ts";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";
import { StarCatalog, type StarName } from "@warpgogol/werkstatt-shared/ontology/cosmic";
import { intakeEnvelopeSchema } from "@warpgogol/werkstatt-shared/onboarding/intake";
import { pbpSchemaById } from "@warpgogol/pbp/entities";
import { byteHash } from "@warpgogol/werkstatt-shared/fingerprint";
import { resolveIntakeExportSha256, validateIntakeBundle } from "../intake/intake-validate.ts";
import { isSeedableAsset, planSeedFromIntake, type IntakeSeedPlan } from "./seed-from-intake.ts";
import {
  discoverSystems,
  readSystemConfig,
  writeSystemConfig,
  hasAppsCollision,
  resolveMirrorPath,
  resolveCacheClonePath,
  readSystemState,
  writeSystemState,
} from "./registry-io.ts";
import { runSternsystemPin } from "./sternsystem-pin.ts";
import { identityConfigPath } from "../identity/identity-io.ts";
import { runMissionOpen } from "../mission/mission-open.ts";
import { runMissionAbort } from "../mission/mission-abort.ts";
import { hasTldSuffix } from "@warpgogol/werkstatt-shared/ontology/operations";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { failResult } from "@warpgogol/werkstatt-shared/checks/result-helpers";

export interface SternsystemRegisterData {
  command: "sternsystem.register";
  system: string;
  status: "pass" | "fail";
  registryEntry?: {
    id: string;
    cosmicStar: string;
    status: "registered" | "active";
    registeredAt: string;
  };
  pinPath?: string;
  firstMissionId?: string;
  /** RFC-1307: what register seeded from the intake. */
  seed?: { intakeId: string; pbpDocuments: number; assets: number };
  diagnostics: string[];
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return typeof v === "boolean" ? v : false;
}

function flagNumber(input: KernelCommandInput, key: string): number | undefined {
  const v = input.flags[key];
  return typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined;
}

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  return { flags, argv: [] };
}

/**
 * Ask the site plugin, through the kernel registry, whether a biome id exists
 * and passes its contract. Returns null when it does, else the reason.
 */
async function checkBiomeViaKernel(workspaceRoot: string, biomeId: string): Promise<string | null> {
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
  const result = (await executeKernelCommand({
    workspaceRoot,
    commandName: "biome.contract.validate",
    argv: [`--biome=${biomeId}`],
    outputFormat: "json",
  })) as { exitCode?: number; data?: { diagnostics?: Array<{ ruleId: string; message: string }> } };
  if ((result.exitCode ?? 1) === 0) return null;
  return (
    result.data?.diagnostics?.map((d) => `${d.ruleId}: ${d.message}`).join("; ") ||
    "biome.contract.validate failed"
  );
}

/** Seams for tests — production code always uses the kernel-registry check. */
export const registerDeps = { checkBiome: checkBiomeViaKernel, openMission: runMissionOpen };

/**
 * RFC-1307 preconditions for a new registration — run before any file write.
 * Returns the parsed envelope, the intake.json digest, and the seedable asset
 * bytes, or throws with an actionable message.
 */
export async function prepareIntakeSeed(
  input: { id: string; cosmicStar: string; intakeDir: string; biomeId: string },
  context: KernelRuntimeContext,
): Promise<IntakeSeedPlan> {
  const { io, workspaceRoot } = context;
  const bundleDir = isAbsolute(input.intakeDir)
    ? input.intakeDir
    : resolve(workspaceRoot, input.intakeDir);

  const exportInfo = await resolveIntakeExportSha256(io);
  if (exportInfo === null) {
    throw new Error(
      "[sternsystem.register] intake.schema.generated.yaml is missing — run onboarding.intake.schema.export first",
    );
  }
  const validation = await validateIntakeBundle(bundleDir, io, {
    exportSha256: exportInfo.sha256,
    bundleLabel: input.intakeDir,
  });
  const errors = validation.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    const listed = errors
      .slice(0, 10)
      .map((d) => `${d.rule}: ${d.message}`)
      .join("; ");
    throw new Error(
      `[sternsystem.register] intake ${input.intakeDir} fails onboarding.intake.validate (${errors.length} error(s)) — ${listed}`,
    );
  }
  // Warnings are reported but do not block (RFC-1307).
  for (const d of validation.diagnostics.filter((d) => d.severity === "warning")) {
    context.logger.warn(`[sternsystem.register] intake ${d.rule}: ${d.message}`);
  }

  const intakeBytes = await io.readFileBytes(join(bundleDir, "intake.json"));
  const intake = intakeEnvelopeSchema.parse(JSON.parse(new TextDecoder().decode(intakeBytes)));
  if (intake.systemId !== input.id) {
    throw new Error(
      `[sternsystem.register] intake systemId '${intake.systemId}' differs from --id '${input.id}' — provenance follows the envelope`,
    );
  }

  // Biome check through the kernel registry — the engine never imports the
  // site plugin or hardcodes its catalog path (RFC-1307, RFC-0769).
  const biomeError = await registerDeps.checkBiome(workspaceRoot, input.biomeId);
  if (biomeError !== null) {
    throw new Error(
      `[sternsystem.register] --biome '${input.biomeId}' rejected — ${biomeError}. Run biome.from-intake --id ${input.id} --family <family-id> first.`,
    );
  }

  // DNA-103: every entity parses through its canonical schema before any asset
  // bytes are read — a broken entity must outrank a missing asset file.
  for (const entity of intake.pbp) {
    const schema = pbpSchemaById[entity.schema];
    if (!schema) {
      throw new Error(
        `[sternsystem.register] no canonical PBP schema for ${entity.schema} (${entity.id})`,
      );
    }
    schema.parse(entity);
  }

  const assetBytes = new Map<string, Uint8Array>();
  for (const asset of intake.assets.filter(isSeedableAsset)) {
    assetBytes.set(asset.id, await io.readFileBytes(join(bundleDir, asset.file)));
  }

  return planSeedFromIntake({
    intake,
    intakeSha256: byteHash(intakeBytes),
    systemId: input.id,
    cosmicStar: input.cosmicStar,
    biomeId: input.biomeId,
    assetBytes,
  });
}

async function writeSeedFiles(
  systemDir: string,
  plan: IntakeSeedPlan,
  io: WorkspaceIO,
): Promise<void> {
  for (const file of plan.files) {
    const target = join(systemDir, ...file.path.split("/"));
    await io.mkdir(join(target, ".."));
    await io.writeFile(target, file.content);
  }
}

async function rollbackConfig(workspaceRoot: string, id: string, io: WorkspaceIO): Promise<void> {
  const cacheClone = resolveCacheClonePath(workspaceRoot, id);
  const configPath = join(cacheClone, "system-config.yaml");
  if (await io.exists(configPath)) {
    await io.rm(configPath, { recursive: true });
  }
}

async function rollbackSystemState(
  workspaceRoot: string,
  id: string,
  io: WorkspaceIO,
): Promise<void> {
  const cacheClone = resolveCacheClonePath(workspaceRoot, id);
  const statePath = join(cacheClone, "system-state.yaml");
  if (await io.exists(statePath)) {
    await io.rm(statePath, { recursive: true });
  }
}

async function rollbackPin(systemDir: string, io: WorkspaceIO): Promise<void> {
  const pinPath = join(systemDir, "system.pin.json");
  if (await io.exists(pinPath)) {
    await io.rm(pinPath, { recursive: true });
  }
}

async function rollbackContent(systemDir: string, io: WorkspaceIO): Promise<void> {
  const contentPath = join(systemDir, "src", "content");
  if (await io.exists(contentPath)) {
    await io.rm(contentPath, { recursive: true });
  }
}

async function rollbackSystemDirIfEmpty(systemDir: string, io: WorkspaceIO): Promise<void> {
  if (!(await io.exists(systemDir))) return;
  const gitDir = join(systemDir, ".git");
  if (await io.exists(gitDir)) return;
  await io.rm(systemDir, { recursive: true });
}

/**
 * Rewind the commits register pushed into the cache clone: the writeSystemState
 * auto-commit, the scaffold commit and their pushes to the bare remote. When
 * the clone had no commits before register (fresh repo), every local branch
 * ref is register's own — drop them so HEAD returns to unborn, and delete the
 * pushed branch on the remote. All steps are best-effort: file-level rollback
 * still runs afterwards.
 */
async function rollbackGitHistory(
  systemDir: string,
  preRegisterSha: string | null,
  io: WorkspaceIO,
): Promise<void> {
  const gitDir = join(systemDir, ".git");
  if (!(await io.exists(gitDir))) return;
  const git = (args: string[]) => io.exec("git", args, { cwd: systemDir, timeoutMs: 10000 });
  try {
    let branch = "main";
    const remoteHead = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if (remoteHead.exitCode === 0 && remoteHead.stdout.trim()) {
      branch = remoteHead.stdout.trim().replace(/^origin\//, "");
    }
    if (preRegisterSha) {
      await git(["reset", "--hard", preRegisterSha]);
      // Rewind the remote branch register pushed to — the clone matched
      // preRegisterSha before register, so the remote only has register's pushes.
      await git(["push", "--force-with-lease", "origin", `HEAD:refs/heads/${branch}`]);
    } else {
      const refs = await git(["for-each-ref", "--format=%(refname)", "refs/heads"]);
      const branchRefs = refs.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const ref of branchRefs) {
        await git(["update-ref", "-d", ref]);
      }
      // Drop the staged index so leftover seed files stay plain untracked
      // files for the file-level rollback to remove.
      await git(["rm", "-r", "-f", "-q", "--cached", "."]);
      for (const ref of branchRefs) {
        await git(["push", "origin", `:${ref}`]);
      }
    }
  } catch {
    // Rollback is best-effort — the file-level helpers still run.
  }
}

export async function runSternsystemRegister(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemRegisterData>> {
  const { workspaceRoot, logger } = context;

  const id = flagString(input, "id");
  const cosmicStar = flagString(input, "cosmicStar");
  const mirrorsFlag = flagString(input, "mirrors");
  const platform = flagString(input, "platform");
  const owner = flagString(input, "owner");
  const isAmend = flagBool(input, "amend");
  const amendId = flagNumber(input, "amend-id");
  const intakeDir = flagString(input, "intake");
  const biomeId = flagString(input, "biome");

  if (!id) throw new Error("[sternsystem.register] requires --id <kebab-case-id>");

  // RFC-0902: Reject TLD-suffixed IDs before any file operations.
  if (hasTldSuffix(id)) {
    throw new Error(
      `[sternsystem.register] id '${id}' ends in a TLD suffix — use the business ID without domain TLD (e.g. 'warpgogol' not 'warpgogol-com')`,
    );
  }

  // RFC-1125: identity + signing-key preflight — register either produces a signed
  // passport or blocks. An unsigned passport is worse than no registration.
  // Gates both register and --amend paths (amend missions close into signed bordbuch
  // commits + passport refresh, which need the same identity material).
  const identityExists = await context.io.exists(identityConfigPath(workspaceRoot));
  const signingKeyConfigured = Boolean(
    process.env.SIGNING_PRIVATE_KEY || process.env.SIGNING_PRIVATE_KEY_PATH,
  );
  if (!identityExists || !signingKeyConfigured) {
    const missing = [
      !identityExists ? "werkstatt.identity.json" : null,
      !signingKeyConfigured ? "signing key (SIGNING_PRIVATE_KEY/SIGNING_PRIVATE_KEY_PATH)" : null,
    ]
      .filter(Boolean)
      .join(" and ");
    throw new Error(
      `[sternsystem.register] Missing ${missing}. Run identity.bootstrap first — it creates werkstatt.identity.json and prints the private key for SIGNING_PRIVATE_KEY.`,
    );
  }

  const diagnostics: string[] = [];

  if (isAmend && (intakeDir !== undefined || biomeId !== undefined)) {
    throw new Error(
      "[sternsystem.register] --intake/--biome are for new registrations; --amend reads onboarding/<id>/.input/amend-<N>/",
    );
  }

  if (isAmend) {
    const _config = await readSystemConfig(workspaceRoot, id);

    if (owner) {
      // owner field not in systemConfigSchema — would need schema extension
      // For now, log warning that owner update is not supported in convention-based config
      logger.info(`[sternsystem.register] --amend: owner update not yet supported for '${id}'`);
    }

    const pinInput: Record<string, KernelFlagValue> = { id };
    if (platform) pinInput.platform = platform;
    const pinResult = await runSternsystemPin(makeInput(pinInput), context);
    const pinPath = pinResult.data!.pinPath;

    const brief = amendId ? `Amend ${amendId} for ${id}` : `Amend for ${id}`;
    const missionResult = await runMissionOpen(makeInput({ system: id, brief }), context);
    const missionId = missionResult.data!.missionId;

    return {
      data: {
        command: "sternsystem.register",
        system: id,
        status: "pass",
        pinPath,
        firstMissionId: missionId,
        diagnostics,
      },
      exitCode: 0,
      summary: `[sternsystem.register] amended '${id}' — mission ${missionId} opened and materialized`,
      nextSteps: [
        {
          action: `Validate the system: pnpm exec werkstatt run sternsystem.validate --id ${id}`,
          kind: "optional",
        },
      ],
    };
  }

  if (!cosmicStar) throw new Error("[sternsystem.register] requires --cosmicStar <StarName>");
  if (!mirrorsFlag)
    throw new Error(
      "[sternsystem.register] requires --mirrors <comma-separated-paths> (first is cache, second is bare, rest are external)",
    );

  if (!(StarCatalog as readonly string[]).includes(cosmicStar)) {
    throw new Error(`[sternsystem.register] cosmicStar '${cosmicStar}' is not in StarCatalog`);
  }

  if (await hasAppsCollision(workspaceRoot, id, context.io)) {
    throw new Error(
      `[sternsystem.register] id '${id}' matches existing apps/${id}/ — extract first`,
    );
  }

  // Check for existing system via discovery
  const { systems: existingSystems } = await discoverSystems(workspaceRoot);

  if (existingSystems.some((s) => s.id === id)) {
    throw new Error(`[sternsystem.register] id '${id}' already exists in ../systems-cache/`);
  }

  const starOwner = existingSystems.find(
    (s) => s.cosmicStar === cosmicStar && s.status !== "archived",
  );
  if (starOwner) {
    throw new Error(
      `[sternsystem.register] cosmicStar '${cosmicStar}' is already used by '${starOwner.id}' (status: ${starOwner.status})`,
    );
  }

  const pinnedPlatform = platform ?? existingSystems[0]?.pinnedPlatform ?? "0.0.0";

  type ValidStorageType = "non-bare" | "bare" | "bundle";
  const mirrors = mirrorsFlag.split(",").map((entry) => {
    const m = entry.match(/^(.+):(non-bare|bare|bundle)$/);
    if (m) {
      return { path: m[1], storageType: m[2] as ValidStorageType };
    }
    return { path: entry, storageType: "non-bare" as const };
  });

  // mirrors[0] is always the conventional non-bare cache clone — seeded files
  // and registry config/state write into the same directory (AGENTS.md).
  if (
    mirrors[0].storageType !== "non-bare" ||
    resolveMirrorPath(workspaceRoot, mirrors[0].path) !== resolveCacheClonePath(workspaceRoot, id)
  ) {
    throw new Error(
      `[sternsystem.register] mirrors[0] must be the conventional non-bare cache clone '../systems-cache/${id}' — got '${mirrors[0].path}'`,
    );
  }

  const newConfig = {
    schemaVersion: "1.0.0" as const,
    id,
    cosmicStar: cosmicStar as StarName,
    mirrors,
    pinnedPlatform,
    status: "registered" as const,
    registeredAt: new Date().toISOString(),
    notes: "",
  };

  // RFC-1307: the intake bundle is the only input for a new Sternsystem (I3).
  if (!intakeDir) {
    throw new Error(
      "[sternsystem.register] requires --intake <bundle-dir> — run onboarding.intake.validate --id <id> on onboarding/<id>/.input/intake first",
    );
  }
  if (!biomeId) {
    throw new Error(
      "[sternsystem.register] requires --biome <biome-id> — run family.detect --id <id> and biome.from-intake --id <id> --family <family-id> first",
    );
  }
  // RFC-1307: every intake precondition runs before the first write.
  const seedPlan = await prepareIntakeSeed({ id, cosmicStar, intakeDir, biomeId }, context);

  const systemDir = resolveMirrorPath(workspaceRoot, mirrors[0].path);
  await context.io.mkdir(systemDir);
  // Record the clone's pre-register HEAD so a failed registration can rewind
  // the commits writeSystemState and the scaffold step make.
  let preRegisterSha: string | null = null;
  if (await context.io.exists(join(systemDir, ".git"))) {
    const head = await context.io.exec("git", ["rev-parse", "HEAD"], {
      cwd: systemDir,
      timeoutMs: 10000,
    });
    preRegisterSha = head.exitCode === 0 ? head.stdout.trim() || null : null;
  }
  await writeSystemConfig(workspaceRoot, id, newConfig);

  let pinCreated = false;
  let contentCreated = false;
  let missionOpened = false;
  let missionId: string | undefined;

  try {
    const pinInput: Record<string, KernelFlagValue> = { id };
    if (platform) pinInput.platform = platform;
    const pinResult = await runSternsystemPin(makeInput(pinInput), context);
    const pinPath = pinResult.data!.pinPath;
    pinCreated = true;

    await writeSeedFiles(systemDir, seedPlan, context.io);
    contentCreated = true;
    const state = await readSystemState(workspaceRoot, id, context.io);
    await writeSystemState(
      workspaceRoot,
      id,
      { ...state, onboarding: seedPlan.systemState.onboarding },
      context.io,
    );

    // Commit config, pin, and content to cache clone before mission.open
    // so syncCacheClone's git reset --hard doesn't wipe uncommitted files
    if (await context.io.exists(join(systemDir, ".git"))) {
      try {
        const addResult = await context.io.exec("sh", ["-c", "git add -A"], {
          cwd: systemDir,
          timeoutMs: 10000,
        });
        if (addResult.exitCode !== 0) {
          throw new Error(
            `git add -A exited ${addResult.exitCode}: ${addResult.stderr.slice(0, 200)}`,
          );
        }
        await cacheCloneCommit(systemDir, `sternsystem.register: scaffold ${id}`);
        // Push to bare repo so syncCacheClone can fetch
        try {
          const pushResult = await context.io.exec("sh", ["-c", "git push origin main"], {
            cwd: systemDir,
            timeoutMs: 10000,
          });
          if (pushResult.exitCode !== 0) {
            throw new Error(
              `git push exited ${pushResult.exitCode}: ${pushResult.stderr.slice(0, 200)}`,
            );
          }
        } catch {
          // push failure non-fatal
        }
      } catch {
        // commit failure non-fatal (nothing to commit)
      }
    }

    const missionResult = await registerDeps.openMission(
      makeInput({ system: id, brief: `Initial onboarding for ${id}` }),
      context,
    );
    missionId = missionResult.data!.missionId;
    missionOpened = true;

    // RFC-0951: mission.open now auto-materializes the workpiece internally.
    // No explicit runMissionMaterialize call needed here.

    // RFC-0574: mirror hook removed — star topology uses explicit sternsystem.sync
    void workspaceRoot;

    // RFC-0966: Generate initial passport at site birth. The RFC-1125 preflight
    // guarantees a signing key is configured — generation failures are still
    // non-fatal (e.g. malformed key material surfaces downstream).
    try {
      const { runSternsystemPassportGenerate } = await import("./sternsystem-passport-generate.ts");
      await runSternsystemPassportGenerate(makeInput({ id, actor: "human:operator" }), context);
      logger.info(`  [sternsystem.register] Initial passport generated for ${id}`);
    } catch (passportErr) {
      logger.warn(
        `  [sternsystem.register] Passport generation failed (non-fatal): ${passportErr instanceof Error ? passportErr.message : String(passportErr)}`,
      );
    }

    // RFC-1124: publish initial fleet claim at site birth (non-fatal — skips
    // silently without werkstatt.fleet.json or a signing key).
    try {
      const { loadFleetClaimsConfig, loadSigningKeyFromEnv, publishClaim } =
        await import("../fleet/claims-repo.ts");
      const signingKey = await loadSigningKeyFromEnv();
      if (signingKey && (await loadFleetClaimsConfig(workspaceRoot))) {
        await publishClaim({
          systemId: id,
          werkstattRoot: workspaceRoot,
          signerPrivateKeyHex: signingKey.privateKeyHex,
          signerPublicKey: signingKey.publicKeyHex,
        });
        logger.info(`  [sternsystem.register] Initial fleet claim published for ${id}`);
      }
    } catch (claimErr) {
      logger.warn(
        `  [sternsystem.register] fleet claim publish failed (non-fatal): ${claimErr instanceof Error ? claimErr.message : String(claimErr)}`,
      );
    }

    logger.success(
      `[sternsystem.register] registered '${id}' (cosmicStar: ${cosmicStar}) — mission ${missionId} opened and materialized`,
    );

    return {
      data: {
        command: "sternsystem.register",
        system: id,
        status: "pass",
        registryEntry: {
          id,
          cosmicStar,
          status: "active",
          registeredAt: newConfig.registeredAt,
        },
        pinPath,
        firstMissionId: missionId,
        seed: {
          intakeId: seedPlan.systemState.onboarding.intakeId,
          pbpDocuments: seedPlan.pbpDocuments,
          assets: seedPlan.assets,
        },
        diagnostics,
      },
      exitCode: 0,
      summary: `[sternsystem.register] ${id} registered with cosmicStar ${cosmicStar} — mission ${missionId} materialized`,
      nextSteps: [
        {
          action: `Validate the system: pnpm exec werkstatt run sternsystem.validate --id ${id}`,
          kind: "optional",
        },
      ],
    };
  } catch (error) {
    logger.info(
      `[sternsystem.register] rolling back due to error: ${error instanceof Error ? error.message : String(error)}`,
    );

    if (missionOpened && missionId) {
      try {
        await runMissionAbort(
          makeInput({ mission: missionId, reason: "sternsystem.register rollback" }),
          context,
        );
      } catch (abortError) {
        diagnostics.push(
          `mission.abort during rollback failed: ${abortError instanceof Error ? abortError.message : String(abortError)}`,
        );
      }
    }
    // Git rewind first — restores tracked files to the pre-register state;
    // the file-level helpers then remove any untracked leftovers.
    await rollbackGitHistory(systemDir, preRegisterSha, context.io);
    if (contentCreated) {
      await rollbackContent(systemDir, context.io);
    }
    if (pinCreated) {
      await rollbackPin(systemDir, context.io);
    }
    await rollbackConfig(workspaceRoot, id, context.io);
    await rollbackSystemState(workspaceRoot, id, context.io);
    await rollbackSystemDirIfEmpty(systemDir, context.io);

    diagnostics.push(
      `sternsystem.register failed: ${error instanceof Error ? error.message : String(error)}`,
    );

    return {
      ...failResult("sternsystem.register", [
        `[sternsystem.register] ${id} failed and rolled back: ${error instanceof Error ? error.message : String(error)}`,
      ]),
      data: {
        command: "sternsystem.register",
        system: id,
        status: "fail",
        diagnostics,
      },
    };
  }
}
