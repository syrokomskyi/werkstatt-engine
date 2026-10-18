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
<!-- risk: delete -->
<!-- risk: fs-write -->
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1307: initialise missing cache clone repo during register</item>
  <item>RFC-1307: add register --domain for intakes without a confirmed domain</item>
  <item>RFC-1307: seed default operator config files at registration</item>
  <item>RFC-1307: seed the platform CSP sink allowlist disposition at registration</item>
  <item>RFC-1325: provisional workers.dev as first-class site host

Single host predicate module in werkstatt-shared; provisional registration derives dev/alt/main workers.dev channels from the account subdomain; first dev deploy auto-protects provisional hosts; provisional main responses carry noindex; dns-aid skips provisional sites; site.domain.adopt cuts over to a custom domain.</item>
  <history>REVIEW-CODE-2026, RFC-0354, RFC-0532, RFC-0561, RFC-0902, RFC-1149, RFC-1249, RFC-1293, RFC-1294, RFC-1307</history>
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
import { OPERATOR_CONFIG_FILES } from "../mission/operator-config-files.ts";
import { identityConfigPath } from "../identity/identity-io.ts";
import { runMissionOpen } from "../mission/mission-open.ts";
import { runMissionAbort } from "../mission/mission-abort.ts";
import { hasTldSuffix } from "@warpgogol/werkstatt-shared/ontology/operations";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { failResult } from "@warpgogol/werkstatt-shared/checks/result-helpers";
import { isProvisionalHost } from "@warpgogol/werkstatt-shared/middleware/site-host";
import { deriveProvisionalDeployment, type ProvisionalDeployment } from "./provisional-host.ts";
import { resolveSubdomainEnv } from "../subdomain/subdomain-helpers.ts";

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
  input: {
    id: string;
    cosmicStar: string;
    intakeDir: string;
    biomeId: string;
    domain?: string;
  },
  context: KernelRuntimeContext,
): Promise<IntakeSeedPlan & { provisionalDeployment?: ProvisionalDeployment }> {
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

  // Materialization needs a site host (public.infrastructure.generate, astro
  // site URL) — refuse before any write instead of failing mid-materialize.
  const intakeDomain = intake.classification.domain ?? null;
  if (input.domain !== undefined && intakeDomain !== null && input.domain !== intakeDomain) {
    throw new Error(
      `[sternsystem.register] --domain '${input.domain}' conflicts with the intake's confirmed domain '${intakeDomain}' — the intake wins; drop --domain`,
    );
  }
  if (intakeDomain === null && input.domain === undefined) {
    throw new Error(
      "[sternsystem.register] the intake carries no confirmed domain — pass --domain <host> (e.g. the provisional <worker>.<account>.workers.dev host) until the real domain is decided", // site-host: operator-facing guidance text, not host classification
    );
  }
  if (input.domain !== undefined && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(input.domain)) {
    throw new Error(
      `[sternsystem.register] --domain '${input.domain}' is not a bare lowercase host name (no scheme, no path)`,
    );
  }

  // RFC-1325: a provisional workers.dev host is a first-class birth host —
  // verify the account + worker-name availability and derive the deployment
  // block before any write.
  const effectiveDomain = intakeDomain ?? input.domain;
  let provisionalDeployment: ProvisionalDeployment | undefined;
  if (effectiveDomain !== undefined && isProvisionalHost(effectiveDomain)) {
    const env = await resolveSubdomainEnv();
    provisionalDeployment = await deriveProvisionalDeployment(
      input.id,
      effectiveDomain,
      io,
      workspaceRoot,
      env,
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

  const plan = planSeedFromIntake({
    intake,
    intakeSha256: byteHash(intakeBytes),
    systemId: input.id,
    cosmicStar: input.cosmicStar,
    biomeId: input.biomeId,
    ...(input.domain !== undefined ? { domainFallback: input.domain } : {}),
    assetBytes,
  });
  return provisionalDeployment === undefined ? plan : { ...plan, provisionalDeployment };
}

async function writeSeedFiles(
  systemDir: string,
  plan: IntakeSeedPlan,
  io: WorkspaceIO,
  written: string[],
): Promise<void> {
  // Refuse to overwrite anything already on disk — a pre-existing file at a
  // planned path is not register's to clobber, and rollback must never delete
  // it (REVIEW-CODE-2026-10-16-09 N12). Checked before the first write so a
  // collision leaves zero partial output.
  for (const file of plan.files) {
    const target = join(systemDir, ...file.path.split("/"));
    if (await io.exists(target)) {
      throw new Error(
        `[sternsystem.register] seed path already exists: ${file.path} — refusing to overwrite pre-existing content`,
      );
    }
  }
  for (const file of plan.files) {
    const target = join(systemDir, ...file.path.split("/"));
    await io.mkdir(join(target, ".."));
    await io.writeFile(target, file.content);
    written.push(file.path);
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

/** Remove the seeded files register actually wrote + dirs it created; pre-existing content stays. */
async function rollbackSeedFiles(
  systemDir: string,
  seededPaths: string[],
  io: WorkspaceIO,
): Promise<void> {
  const parentDirs = new Set<string>();
  for (const filePath of seededPaths) {
    const target = join(systemDir, ...filePath.split("/"));
    if (await io.exists(target)) {
      await io.rm(target, { recursive: true });
    }
    let dir = join(target, "..");
    while (dir !== systemDir && dir.startsWith(systemDir)) {
      parentDirs.add(dir);
      dir = join(dir, "..");
    }
  }
  // Deepest first — a dir that still holds entries is pre-existing and stays.
  for (const dir of [...parentDirs].sort((a, b) => b.length - a.length)) {
    try {
      if ((await io.readdir(dir)).length === 0) {
        await io.rm(dir, { recursive: true });
      }
    } catch {
      // Already removed by an earlier prune — cosmetic only.
    }
  }
}

async function rollbackContent(systemDir: string, io: WorkspaceIO): Promise<void> {
  const contentPath = join(systemDir, "src", "content");
  if (await io.exists(contentPath)) {
    await io.rm(contentPath, { recursive: true });
  }
}

/**
 * Remove the clone dir only when it is git-less AND empty. Callers invoke this
 * solely for dirs register itself created — a pre-existing dir is never
 * removed, no matter its contents (REVIEW-CODE-2026-10-16-09 N8). Returns the
 * outcome so the caller can log WHY a dir survived; a failed readdir/rm keeps
 * the dir and never throws — rollback must not escape the catch handler with
 * a secondary error (REVIEW-CODE-2026-10-16-10 O1).
 */
type DirRollbackOutcome = "removed" | "kept-git" | "kept-nonempty" | "kept-error";

async function rollbackSystemDirIfEmpty(
  systemDir: string,
  io: WorkspaceIO,
): Promise<DirRollbackOutcome> {
  if (!(await io.exists(systemDir))) return "removed";
  const gitDir = join(systemDir, ".git");
  if (await io.exists(gitDir)) return "kept-git";
  let entryCount: number;
  try {
    entryCount = (await io.readdir(systemDir)).length;
  } catch {
    return "kept-error";
  }
  if (entryCount !== 0) return "kept-nonempty";
  try {
    await io.rm(systemDir, { recursive: true });
  } catch {
    return "kept-error";
  }
  return "removed";
}

/** Git state captured before register's first write — rollback trusts only this. */
interface PreRegisterGit {
  /** The probe ran; refs + sha are trustworthy. False = skip ref surgery entirely. */
  captured: boolean;
  /** HEAD commit at capture — null only when HEAD was genuinely unborn. */
  sha: string | null;
  /** refs/heads/* present before register — never touched by rollback. */
  refs: string[];
  /** The branch register pushes to (origin/HEAD-derived, falls back to "main"). */
  branch: string;
  /**
   * Non-untracked entries in git status at capture — uncommitted tracked or
   * staged work register would destroy with reset --hard on rollback. Register
   * refuses before the first write (REVIEW-CODE-2026-10-16-09 N12).
   */
  dirty: boolean;
  /**
   * origin's refs/heads/* at capture (sha by refname). Null = ls-remote was
   * unreachable/failed — rollback then skips ALL remote surgery rather than
   * guess at remote state (REVIEW-CODE-2026-10-16-09 N9).
   */
  remoteRefs: Record<string, string> | null;
}

/**
 * A fresh Sternsystem has no cache clone repository yet: initialise it in
 * place (`git init -b main`) with `origin` pointing at the local bare mirror
 * (mirrors[1]), so the scaffold commit, its push and mission.open's Bordbuch
 * commit have a repository to land in. An existing repository is left alone;
 * an external-only mirrors[1] (URL) leaves the clone without origin.
 * Returns true when register created the repository (rollback removes it).
 */
async function ensureCacheCloneRepo(
  systemDir: string,
  mirrors: ReadonlyArray<{ path: string; storageType: string }>,
  workspaceRoot: string,
  io: WorkspaceIO,
): Promise<boolean> {
  if (await io.exists(join(systemDir, ".git"))) return false;
  const git = async (args: string[]) => {
    const result = await io.exec("git", args, { cwd: systemDir, timeoutMs: 10000 });
    if (result.exitCode !== 0) {
      throw new Error(
        `[sternsystem.register] git ${args.join(" ")} exited ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
      );
    }
  };
  await git(["init", "-b", "main"]);
  const bare = mirrors[1];
  if (bare?.storageType === "bare" && !/^[a-z]+:\/\/|^[^/]+@[^:]+:/i.test(bare.path)) {
    await git(["remote", "add", "origin", resolveMirrorPath(workspaceRoot, bare.path)]);
  }
  return true;
}

/**
 * Default content for the required operator config files (RFC-0840). A fresh
 * system has none, and workpiece.config.presence.check would fail the first
 * mission.validate; register seeds them into its scaffold commit (missions
 * track and reconcile later edits). Operators tune them in missions.
 */
export const OPERATOR_CONFIG_DEFAULTS: Readonly<
  Record<(typeof OPERATOR_CONFIG_FILES)[number], string>
> = {
  ".lighthouse-budget-ignore":
    "# RFC-0833 LH-12 escape hatch: one JS bundle name per line that is emitted\n# but intentionally not referenced by any page. Seeded empty at registration.\n",
  "src/image-delivery.config.yaml":
    "# RFC-0830 IMG-DELIVERY escape-hatch overrides.\n# Each entry needs: srcPattern, rules[], reason. Seeded empty at registration.\noverrides: []\n",
};

/**
 * Site-level defaults every Astro site needs from its first build: the CSP sink
 * allowlist disposition for the platform schema chunk (guarded `new Function`
 * capability probe emitted into every site bundle). Dispositions stay per-site
 * (csp.sinks.validate never blesses sinks itself); this only seeds the common one.
 */
export const SITE_BIRTH_DEFAULTS: Readonly<Record<string, string>> = {
  "src/csp-sinks.allowlist.yaml": [
    "version: 1",
    "entries:",
    '  - filePattern: "_astro/schemas.*.js"',
    "    disposition: accepted-debt",
    "    note: \"Platform schema bundle carries a guarded new Function('') capability probe (try/catch + UA check); no user-controlled markup reaches it.\"",
    "",
  ].join("\n"),
};

/** Write missing operator config and site birth defaults; returns the paths register created. */
async function seedOperatorConfigDefaults(systemDir: string, io: WorkspaceIO): Promise<string[]> {
  const created: string[] = [];
  const defaults: Array<[string, string]> = [
    ...OPERATOR_CONFIG_FILES.map((rel): [string, string] => [rel, OPERATOR_CONFIG_DEFAULTS[rel]]),
    ...Object.entries(SITE_BIRTH_DEFAULTS),
  ];
  for (const [rel, content] of defaults) {
    const target = join(systemDir, ...rel.split("/"));
    if (await io.exists(target)) continue;
    await io.mkdir(join(target, ".."));
    await io.writeFile(target, content);
    created.push(target);
  }
  return created;
}

/**
 * Probe the clone's git state before register writes: HEAD sha (or confirmed
 * unborn), the pre-existing branch refs, and the push branch. An ambiguous
 * probe (rev-parse fails without an unborn HEAD, or any exec throw) yields
 * captured=false — rollback then skips ref surgery rather than risk deleting
 * branches it cannot attribute to register (REVIEW-CODE-2026-10-16-08 N1).
 */
async function capturePreRegisterGit(systemDir: string, io: WorkspaceIO): Promise<PreRegisterGit> {
  const failed: PreRegisterGit = {
    captured: false,
    sha: null,
    refs: [],
    branch: "main",
    dirty: false,
    remoteRefs: null,
  };
  if (!(await io.exists(join(systemDir, ".git")))) {
    return { ...failed, captured: true };
  }
  const git = (args: string[]) => io.exec("git", args, { cwd: systemDir, timeoutMs: 10000 });
  try {
    let branch = "main";
    const remoteHead = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if (remoteHead.exitCode === 0 && remoteHead.stdout.trim()) {
      branch = remoteHead.stdout.trim().replace(/^origin\//, "");
    }
    const refsResult = await git(["for-each-ref", "--format=%(refname)", "refs/heads"]);
    if (refsResult.exitCode !== 0) return failed;
    const refs = refsResult.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    // Tracked modifications or staged entries would be destroyed by the
    // rollback's reset --hard — register refuses to run at all (N12). Untracked
    // (??) entries are safe: reset --hard never touches them and the
    // pathspec-scoped add never stages them.
    const status = await git(["status", "--porcelain"]);
    if (status.exitCode !== 0) return failed;
    const dirty = status.stdout
      .split("\n")
      .some((line) => line.trim() !== "" && !line.startsWith("??"));
    const head = await git(["rev-parse", "HEAD"]);
    let sha: string | null = null;
    if (head.exitCode === 0) {
      sha = head.stdout.trim() || null;
    } else {
      // rev-parse fails for unborn HEAD and for corrupt/detached states alike —
      // only a symbolic HEAD pointing at a branch ref proves "unborn".
      const sym = await git(["symbolic-ref", "-q", "HEAD"]);
      if (!(sym.exitCode === 0 && sym.stdout.trim().startsWith("refs/heads/"))) return failed;
    }
    // Remote refs at capture — the rollback's remote surgery trusts only this
    // snapshot, never possibly-stale remote-tracking refs (N9). An unreachable
    // or unconfigured origin yields null → remote steps are skipped with a
    // diagnostic rather than guessed.
    let remoteRefs: Record<string, string> | null = null;
    const remote = await git(["ls-remote", "origin", "refs/heads/*"]);
    if (remote.exitCode === 0) {
      remoteRefs = {};
      for (const line of remote.stdout.split("\n")) {
        const [rsha, rref] = line.split("\t");
        const ref = rref?.trim();
        if (rsha?.trim() && ref?.startsWith("refs/heads/")) {
          remoteRefs[ref] = rsha.trim();
        }
      }
    }
    return { captured: true, sha, refs, branch, dirty, remoteRefs };
  } catch {
    return failed;
  }
}

/**
 * Rewind the commits register pushed into the cache clone: the writeSystemState
 * auto-commit, the scaffold commit and their pushes to the bare remote. Runs
 * AFTER the file-level helpers — a reset restores pre-existing tracked files,
 * so deleting register's files first and resetting second leaves the clone
 * exactly at its pre-register state (REVIEW-CODE-2026-10-16-08 N2). Only refs
 * register created are deleted — anything captured pre-register is untouched.
 * Failures are reported via diagnostics, never silently swallowed.
 */
async function rollbackGitHistory(
  systemDir: string,
  pre: PreRegisterGit,
  io: WorkspaceIO,
  diagnostics: string[],
): Promise<void> {
  const gitDir = join(systemDir, ".git");
  if (!(await io.exists(gitDir))) return;
  if (!pre.captured) {
    diagnostics.push(
      "rollback: pre-register git probe was unreliable — skipped ref surgery; file-level rollback already ran",
    );
    return;
  }
  const git = (args: string[]) => io.exec("git", args, { cwd: systemDir, timeoutMs: 10000 });
  // Delete a remote ref: leased push first — the lease is anchored on the sha
  // observed in the just-read remote snapshot, so a foreign push landing in the
  // window between read and delete fails the lease instead of being removed
  // (REVIEW-CODE-2026-10-16-10 O2). When the remote is a local-path mirror
  // (the systems-git convention) whose HEAD names the ref, receive-pack's
  // denyDeleteCurrent refuses — the operator owns the dir, so verify the ref
  // still holds the expected sha and delete in place; a moved ref is foreign
  // and survives.
  const tryDeleteRemoteRef = async (refname: string, expectedSha: string): Promise<void> => {
    const del = await git([
      "push",
      `--force-with-lease=${refname}:${expectedSha}`,
      "origin",
      `:${refname}`,
    ]);
    if (del.exitCode === 0) return;
    const url = await git(["remote", "get-url", "origin"]);
    const configured = url.exitCode === 0 ? url.stdout.trim() : "";
    const remotePath = configured.startsWith("file://")
      ? configured.slice("file://".length)
      : configured;
    const resolved =
      remotePath && !isAbsolute(remotePath) ? join(systemDir, remotePath) : remotePath;
    if (resolved && (await io.exists(resolved))) {
      const cur = await git(["-C", resolved, "rev-parse", "--verify", refname]);
      const curSha = cur.exitCode === 0 ? cur.stdout.trim() : "";
      if (curSha !== expectedSha) {
        diagnostics.push(
          `rollback: remote ${refname} moved since the last observation (${curSha.slice(0, 12) || "absent"}) — left untouched`,
        );
        return;
      }
      const direct = await git(["-C", resolved, "update-ref", "-d", refname]);
      if (direct.exitCode === 0) return;
      diagnostics.push(
        `rollback: in-place remote delete of ${refname} failed (non-fatal): ${direct.stderr.slice(0, 160)}`,
      );
      return;
    }
    diagnostics.push(
      `rollback: remote delete of ${refname} failed (non-fatal): ${del.stderr.slice(0, 160)}`,
    );
  };
  try {
    if (pre.sha) {
      const reset = await git(["reset", "--hard", pre.sha]);
      if (reset.exitCode !== 0) {
        diagnostics.push(
          `rollback: git reset --hard ${pre.sha} failed: ${reset.stderr.slice(0, 160)}`,
        );
      }
    }
    // Rewind the remote branch register pushed to — anchored on the remote
    // refs captured pre-register AND the remote's state right now, never on
    // possibly-stale remote-tracking refs (REVIEW-CODE-2026-10-16-09 N9).
    // Three cases: register created the remote branch → delete it; register
    // moved a pre-existing branch → restore the captured sha with a lease
    // pinned to the sha just observed; remote untouched → nothing to do.
    const remoteKey = `refs/heads/${pre.branch}`;
    // Remote state observed right now — read once, reused by the branch surgery
    // AND the created-refs cleanup below (REVIEW-10 O2: deletes consult it too).
    let nowRefs: Record<string, string> | null = null;
    if (pre.remoteRefs === null) {
      diagnostics.push(
        "rollback: remote refs were not captured — remote branch state left untouched",
      );
    } else {
      const now = await git(["ls-remote", "origin", "refs/heads/*"]);
      if (now.exitCode !== 0) {
        diagnostics.push(
          `rollback: ls-remote failed — remote state unverifiable, remote left untouched (non-fatal): ${now.stderr.slice(0, 160)}`,
        );
      } else {
        nowRefs = {};
        for (const line of now.stdout.split("\n")) {
          const [rsha, rref] = line.split("\t");
          const ref = rref?.trim();
          if (rsha?.trim() && ref?.startsWith("refs/heads/")) {
            nowRefs[ref] = rsha.trim();
          }
        }
        const preRemoteSha = pre.remoteRefs[remoteKey];
        const nowSha = nowRefs[remoteKey];
        if (nowSha !== undefined && preRemoteSha === undefined) {
          // Register created this remote branch — delete it, lease-anchored on
          // the just-observed sha (O2).
          await tryDeleteRemoteRef(remoteKey, nowSha);
        } else if (nowSha !== undefined && preRemoteSha !== undefined && nowSha !== preRemoteSha) {
          // Register moved a pre-existing remote branch — restore its captured
          // sha, lease-asserted on the sha observed moments ago (a concurrent
          // foreign push fails the lease instead of being clobbered).
          const rew = await git([
            "push",
            `--force-with-lease=${remoteKey}:${nowSha}`,
            "origin",
            `${preRemoteSha}:${remoteKey}`,
          ]);
          if (rew.exitCode !== 0) {
            diagnostics.push(
              `rollback: remote rewind of ${remoteKey} to ${preRemoteSha.slice(0, 12)} failed (non-fatal): ${rew.stderr.slice(0, 160)}`,
            );
          }
        } else if (nowSha === undefined && preRemoteSha !== undefined) {
          diagnostics.push(
            `rollback: remote branch ${remoteKey} vanished externally during register — left as-is`,
          );
        }
      }
    }
    // Delete only refs register created — pre-register refs are never touched,
    // whether HEAD was unborn or rev-parse was merely confused at capture.
    const current = await git(["for-each-ref", "--format=%(refname)", "refs/heads"]);
    if (current.exitCode === 0) {
      const preRefs = new Set(pre.refs);
      const created = current.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter((r) => r !== "" && !preRefs.has(r));
      for (const ref of created) {
        const del = await git(["update-ref", "-d", ref]);
        if (del.exitCode !== 0) {
          diagnostics.push(
            `rollback: failed to delete register-created ${ref}: ${del.stderr.slice(0, 160)}`,
          );
          continue;
        }
        // Remote counterpart: delete only when the pre-snapshot proves the
        // remote ref did not exist before register — a same-named remote
        // branch predating register is not ours to remove (N9). The delete
        // consults the just-read remote state: absent means nothing to remove,
        // unverifiable means leave untouched (O2).
        if (pre.remoteRefs === null) {
          diagnostics.push(
            `rollback: remote refs uncaptured — remote ${ref} (if any) left untouched`,
          );
          continue;
        }
        if (pre.remoteRefs[ref] !== undefined) continue;
        if (nowRefs === null) {
          diagnostics.push(
            `rollback: remote state unverifiable — remote ${ref} (if any) left untouched`,
          );
          continue;
        }
        const createdRemoteSha = nowRefs[ref];
        if (createdRemoteSha === undefined) continue;
        await tryDeleteRemoteRef(ref, createdRemoteSha);
      }
    }
    if (!pre.sha) {
      // Unborn-HEAD path: drop the staged index so file-level rollback output
      // stays plain untracked deletions — read-tree --empty has no HEAD
      // dependency, unlike git rm --cached.
      await git(["read-tree", "--empty"]);
    }
  } catch {
    diagnostics.push(
      "rollback: git history rewind aborted mid-way — file-level rollback already ran",
    );
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
  const domainFlag = flagString(input, "domain");

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

  if (isAmend && (intakeDir !== undefined || biomeId !== undefined || domainFlag !== undefined)) {
    throw new Error(
      "[sternsystem.register] --intake/--biome/--domain are for new registrations; --amend reads onboarding/<id>/.input/amend-<N>/",
    );
  }

  if (isAmend) {
    const _config = await readSystemConfig(workspaceRoot, id, context.io);

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
  const { systems: existingSystems } = await discoverSystems(workspaceRoot, context.io);

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
  const seedPlan = await prepareIntakeSeed(
    { id, cosmicStar, intakeDir, biomeId, ...(domainFlag ? { domain: domainFlag } : {}) },
    context,
  );

  const systemDir = resolveMirrorPath(workspaceRoot, mirrors[0].path);
  // A pre-existing clone dir is NEVER removed by rollback — only a dir
  // register itself created is (REVIEW-CODE-2026-10-16-09 N8).
  const systemDirExisted = await context.io.exists(systemDir);
  await context.io.mkdir(systemDir);
  const repoInitialized = await ensureCacheCloneRepo(systemDir, mirrors, workspaceRoot, context.io);
  // Capture the clone's git state before the first write so a failed
  // registration can distinguish register's own files/commits from anything
  // that was already there (REVIEW-CODE-2026-10-16-08 N1/N2).
  const preGit = await capturePreRegisterGit(systemDir, context.io);
  // Uncommitted tracked or staged work would be destroyed by the rollback's
  // reset --hard — refuse before the first write rather than risk it
  // (REVIEW-CODE-2026-10-16-09 N12). The just-created dir is git-less, so a
  // fresh clone can never trip this.
  if (preGit.dirty) {
    throw new Error(
      `[sternsystem.register] cache clone has uncommitted changes — commit or clean ${systemDir} before registering`,
    );
  }
  const contentDirExisted = await context.io.exists(join(systemDir, "src", "content"));
  // Byte capture for files register overwrites — a pre-existing file that was
  // never committed cannot be restored by the git rewind alone (N2).
  const readIfExists = async (filePath: string): Promise<string | null> =>
    (await context.io.exists(filePath)) ? await context.io.readFile(filePath) : null;
  const preConfigBytes = await readIfExists(join(systemDir, "system-config.yaml"));
  const preStateBytes = await readIfExists(join(systemDir, "system-state.yaml"));
  const prePinBytes = await readIfExists(join(systemDir, "system.pin.json"));

  let pinCreated = false;
  let contentCreated = false;
  let configCreated = false;
  let stateCreated = false;
  let missionOpened = false;
  let missionId: string | undefined;
  // Paths register actually wrote — rollback removes ONLY these, never a
  // pre-existing file that happens to share a planned path (REVIEW-09 N12).
  const seededPaths: string[] = [];
  // Untracked operator config defaults register created — removed on rollback.
  const operatorConfigCreated: string[] = [];

  try {
    // Inside the guarded scope: a config-write failure must not orphan the
    // clone directory register just created (REVIEW-CODE-2026-10-16-08 N7).
    // Flags mark "write begun", not "write succeeded" — a mid-write throw
    // leaves partial output that rollback must still remove.
    configCreated = true;
    await writeSystemConfig(
      workspaceRoot,
      id,
      seedPlan.provisionalDeployment === undefined
        ? newConfig
        : { ...newConfig, deployment: seedPlan.provisionalDeployment },
      context.io,
    );

    const pinInput: Record<string, KernelFlagValue> = { id };
    if (platform) pinInput.platform = platform;
    pinCreated = true;
    const pinResult = await runSternsystemPin(makeInput(pinInput), context);
    const pinPath = pinResult.data!.pinPath;

    contentCreated = true;
    await writeSeedFiles(systemDir, seedPlan, context.io, seededPaths);
    operatorConfigCreated.push(...(await seedOperatorConfigDefaults(systemDir, context.io)));
    // readSystemState may throw on a malformed PRE-EXISTING state file — that
    // file must survive rollback untouched, so the flag arms only once
    // register itself is about to write.
    const state = await readSystemState(workspaceRoot, id, context.io);
    stateCreated = true;
    await writeSystemState(
      workspaceRoot,
      id,
      { ...state, onboarding: seedPlan.systemState.onboarding },
      context.io,
      (msg) => logger.warn(`  [sternsystem.register] ${msg}`),
    );

    // Commit config, pin, and content to cache clone before mission.open
    // so syncCacheClone's git reset --hard doesn't wipe uncommitted files.
    // Add ONLY register's own paths — `git add -A` would sweep pre-existing
    // untracked files into register's commit, and the rollback's reset --hard
    // would then destroy them (REVIEW-CODE-2026-10-16-08 N2).
    if (await context.io.exists(join(systemDir, ".git"))) {
      try {
        const seedPaths = [
          "system-config.yaml",
          "system-state.yaml",
          "system.pin.json",
          ...seedPlan.files.map((f) => f.path),
          // Operator config defaults register created ride the scaffold commit,
          // like every later mission that edits them (reconcile tracks them).
          ...[...OPERATOR_CONFIG_FILES, ...Object.keys(SITE_BIRTH_DEFAULTS)].filter((rel) =>
            operatorConfigCreated.includes(join(systemDir, ...rel.split("/"))),
          ),
        ];
        const existingSeedPaths: string[] = [];
        for (const p of seedPaths) {
          if (await context.io.exists(join(systemDir, ...p.split("/")))) {
            existingSeedPaths.push(p);
          }
        }
        const addResult = await context.io.exec("git", ["add", "--", ...existingSeedPaths], {
          cwd: systemDir,
          timeoutMs: 10000,
        });
        if (addResult.exitCode !== 0) {
          throw new Error(
            `git add exited ${addResult.exitCode}: ${addResult.stderr.slice(0, 200)}`,
          );
        }
        await cacheCloneCommit(
          systemDir,
          `sternsystem.register: scaffold ${id}`,
          undefined,
          context.io,
        );
        // Push to the bare repo's default branch so syncCacheClone can fetch —
        // same branch writeSystemState and the rollback rewind use.
        try {
          const pushResult = await context.io.exec(
            "git",
            ["push", "origin", `HEAD:refs/heads/${preGit.branch}`],
            {
              cwd: systemDir,
              timeoutMs: 10000,
            },
          );
          if (pushResult.exitCode !== 0) {
            throw new Error(
              `git push exited ${pushResult.exitCode}: ${pushResult.stderr.slice(0, 200)}`,
            );
          }
        } catch (pushErr) {
          logger.warn(
            `  [sternsystem.register] scaffold push to origin/${preGit.branch} failed (non-fatal): ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`,
          );
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
    // File-level rollback first, git rewind second — the rewind restores
    // tracked files to the pre-register state, so removing register's files
    // up front guarantees pre-existing content survives (REVIEW-08 N2).
    if (contentCreated) {
      await rollbackSeedFiles(systemDir, seededPaths, context.io);
      for (const created of operatorConfigCreated) {
        if (await context.io.exists(created)) await context.io.rm(created);
      }
      // register created src/content entirely — the dir goes away; if it
      // pre-existed, only register's files were removed.
      if (!contentDirExisted) {
        await rollbackContent(systemDir, context.io);
      }
    }
    if (pinCreated) {
      await rollbackPin(systemDir, context.io);
    }
    if (configCreated) {
      await rollbackConfig(workspaceRoot, id, context.io);
    }
    if (stateCreated) {
      await rollbackSystemState(workspaceRoot, id, context.io);
    }
    await rollbackGitHistory(systemDir, preGit, context.io, diagnostics);
    // A pre-existing file register overwrote survives the rewind only if it was
    // tracked — for the untracked edge, restore the captured bytes (N2).
    const restorePreExisting = async (filePath: string, bytes: string | null) => {
      if (bytes === null) return;
      const exists = await context.io.exists(filePath);
      if (!exists || (await context.io.readFile(filePath)) !== bytes) {
        await context.io.writeFile(filePath, bytes);
      }
    };
    try {
      await restorePreExisting(join(systemDir, "system-config.yaml"), preConfigBytes);
      await restorePreExisting(join(systemDir, "system-state.yaml"), preStateBytes);
      await restorePreExisting(join(systemDir, "system.pin.json"), prePinBytes);
    } catch (restoreErr) {
      diagnostics.push(
        `rollback: pre-existing file restore failed: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`,
      );
    }
    // A repository register initialised itself is register's own output —
    // remove it so a re-run starts from the same git-less state.
    if (repoInitialized) {
      try {
        await context.io.rm(join(systemDir, ".git"), { recursive: true });
      } catch (rmErr) {
        diagnostics.push(
          `rollback: register-initialised .git could not be removed: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
        );
      }
    }
    // Only a dir register itself created is removed — and only when rollback
    // left it empty; a pre-existing dir is never touched (REVIEW-09 N8).
    if (!systemDirExisted) {
      const outcome = await rollbackSystemDirIfEmpty(systemDir, context.io);
      if (outcome === "kept-git") {
        diagnostics.push("rollback: system dir left in place — .git materialized during rollback");
      } else if (outcome === "kept-nonempty") {
        diagnostics.push(
          "rollback: system dir left in place — not empty after file-level rollback",
        );
      } else if (outcome === "kept-error") {
        diagnostics.push("rollback: system dir left in place — could not inspect or remove it");
      }
    }

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
