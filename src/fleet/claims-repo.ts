/*
<MODULE_CONTRACT>
<purpose>
RFC-1124: Git-native fleet claims registry — pure functions for the per-fleet
claims repository. Manages the local clone (.werkstatt/fleet-claims), builds
and publishes signed claim files, verifies claims offline (self-claim and
transfer-claim legitimacy), resolves conflicts via LWW + owner-signature
precedence ported from kernel/dht/register.ts, and syncs with git remotes.
</purpose>
<non-goals>
  <item>No kernel command types — thin handlers live in claims-commands.ts.</item>
  <item>No auto-merge of diverged claims histories — non-fast-forward is a manual-resolution diagnostic.</item>
  <item>No Worker calls — the RFC-0967 Worker is an optional accelerator, never consulted here.</item>
  <item>No network requirement for verify/status — only publish push and sync fetch touch remotes.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1124: initial claims repository — config, clone management, build/publish/verify/sync/status, transfer-claim legitimacy via bordbuch handover events.</item>
</CHANGE_SUMMARY>
*/

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  signClaim,
  verifyClaim as verifyClaimSignature,
  type FleetClaim,
  type FleetClaimData,
} from "@warpgogol/werkstatt-shared/passport/claim-sign";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import { readPassport } from "../sternsystem/registry-io.ts";
import { deriveInstanceId } from "./ownership-registry.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Workshop-local config: werkstatt.fleet.json (created by fleet.claims.init). */
export interface FleetClaimsConfig {
  /** Remote URL(s) of the per-fleet claims repository. */
  remotes: string[];
  /** Local clone path relative to the werkstatt root. */
  localPath: string;
  /** Optional RFC-0967 Worker URL — accelerator only, never required. */
  workerUrl?: string;
}

export interface ClaimsVerifyResult {
  systemId: string;
  claim: FleetClaim | null;
  /**
   * "valid" | "no-claim" | "invalid-signature" | "stale".
   * "stale" = tombstone (supersededBy set) OR passportHash drift vs the local
   * systems-cache passport when that passport is available.
   */
  verdict: "valid" | "no-claim" | "invalid-signature" | "stale";
  /** Losing claims observed on diverged remote refs at the last sync. */
  conflicts: Array<{ claim: FleetClaim; reason: string }>;
}

export interface PublishClaimResult {
  claim: FleetClaim;
  claimPath: string;
  commit: string;
  pushed: boolean;
  pushErrors: string[];
}

export interface SyncClaimsResult {
  fetched: string[];
  fastForwarded: boolean;
  pushed: boolean;
  diverged: Array<{ remote: string; files: string[] }>;
  invalidClaims: string[];
  errors: string[];
}

export interface ClaimsStatusResult {
  configured: boolean;
  clonePath: string | null;
  remotes: string[];
  claims: number;
  unpushedCommits: number;
  behindRemotes: Array<{ remote: string; behind: number }>;
  lastSyncAt: string | null;
}

const DEFAULT_LOCAL_PATH = ".werkstatt/fleet-claims";
const STATE_FILE = ".werkstatt/fleet-claims-state.json";
const CONFIG_FILE = "werkstatt.fleet.json";

// ---------------------------------------------------------------------------
// Config + clone management
// ---------------------------------------------------------------------------

export async function loadFleetClaimsConfig(
  werkstattRoot: string,
): Promise<FleetClaimsConfig | null> {
  const configPath = path.join(werkstattRoot, CONFIG_FILE);
  if (!existsSync(configPath)) return null;
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<FleetClaimsConfig>;
  return {
    remotes: parsed.remotes ?? [],
    localPath: parsed.localPath ?? DEFAULT_LOCAL_PATH,
    workerUrl: parsed.workerUrl,
  };
}

export function claimsClonePath(werkstattRoot: string, config: FleetClaimsConfig): string {
  return path.isAbsolute(config.localPath)
    ? config.localPath
    : path.join(werkstattRoot, config.localPath);
}

function git(clonePath: string, args: string[]): string {
  return execFileSync("git", ["-C", clonePath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitOk(clonePath: string, args: string[]): boolean {
  try {
    git(clonePath, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open or create the local claims clone. Clones the first configured remote
 * when the directory is absent; falls back to `git init` when the remote is
 * empty or does not exist yet (first publish creates the initial commit).
 */
export async function ensureClaimsClone(
  werkstattRoot: string,
  config: FleetClaimsConfig,
): Promise<string> {
  const clonePath = claimsClonePath(werkstattRoot, config);
  if (existsSync(path.join(clonePath, ".git"))) {
    // Keep remote list in sync with config (idempotent re-init).
    syncGitRemotes(clonePath, config.remotes);
    return clonePath;
  }

  await mkdir(path.dirname(clonePath), { recursive: true });

  let cloned = false;
  if (config.remotes.length > 0) {
    try {
      execFileSync("git", ["clone", config.remotes[0], clonePath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      cloned = true;
    } catch {
      cloned = false; // remote missing/empty/unreachable — init locally
    }
  }

  if (!cloned) {
    await mkdir(clonePath, { recursive: true });
    execFileSync("git", ["-C", clonePath, "init"], { stdio: ["ignore", "pipe", "pipe"] });
  }

  syncGitRemotes(clonePath, config.remotes);
  return clonePath;
}

/** Named remotes: first = "origin", rest = "remote1..N". */
function syncGitRemotes(clonePath: string, remotes: string[]): void {
  const existing = gitOk(clonePath, ["remote"])
    ? git(clonePath, ["remote"]).split("\n").filter(Boolean)
    : [];
  for (const name of existing) {
    execFileSync("git", ["-C", clonePath, "remote", "remove", name], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  remotes.forEach((url, i) => {
    const name = i === 0 ? "origin" : `remote${i}`;
    execFileSync("git", ["-C", clonePath, "remote", "add", name, url], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  });
}

function remoteName(index: number): string {
  return index === 0 ? "origin" : `remote${index}`;
}

// ---------------------------------------------------------------------------
// Claim build + publish
// ---------------------------------------------------------------------------

export interface BuildClaimInput {
  systemId: string;
  werkstattRoot: string;
  /** 32-byte Ed25519 private key as hex (SIGNING_PRIVATE_KEY material). */
  signerPrivateKeyHex: string;
  /** Hex public key matching the private key (passport.creator.publicKey format). */
  signerPublicKey: string;
  /** Transfer claims only: sha256 of handover-authorization.json. */
  authorizationHash?: string | null;
}

/**
 * Build a signed claim for a system from its passport + bordbuch tip.
 * The claim describes the CURRENT passport's creator — for transfer claims the
 * caller signs with the outgoing key and passes authorizationHash.
 */
export async function buildClaim(input: BuildClaimInput): Promise<FleetClaim> {
  const { systemId, werkstattRoot, signerPrivateKeyHex, signerPublicKey } = input;

  const passport = await readPassport(werkstattRoot, systemId);
  if (!passport) {
    throw new Error(
      `[fleet.claims] passport.json not found for ${systemId} — run: pnpm exec werkstatt run sternsystem.passport.generate --id ${systemId}`,
    );
  }

  let bordbuchHead = passport.payload.provenance.bordbuchHead ?? "";
  try {
    const entries = await readBordbuch(werkstattRoot, systemId);
    if (entries.length > 0) bordbuchHead = entries[entries.length - 1].hash;
  } catch {
    // bordbuch missing — fall back to passport provenance
  }

  const data: FleetClaimData = {
    passportHash: passport.passportHash,
    systemId,
    creatorIdentity: passport.payload.creator.identity,
    instanceId: deriveInstanceId(passport.payload.creator.publicKey),
    claimedAt: new Date().toISOString(),
    bordbuchHead,
    supersededBy: null,
    signerPublicKey,
    authorizationHash: input.authorizationHash ?? null,
  };

  const signature = await signClaim(data, signerPrivateKeyHex);
  return { ...data, signature };
}

export interface PublishClaimInput extends BuildClaimInput {
  /** Push to all configured remotes after committing (default true). */
  push?: boolean;
}

/**
 * Write claims/<system-id>.json into the local clone, commit, and push
 * (best-effort — push failure never throws; unpushed state is visible via
 * claimsStatus and retried by syncClaims / sternsystem.sync).
 */
export async function publishClaim(input: PublishClaimInput): Promise<PublishClaimResult> {
  const { werkstattRoot, systemId } = input;
  const config = await loadFleetClaimsConfig(werkstattRoot);
  if (!config) {
    throw new Error(
      `[fleet.claims] ${CONFIG_FILE} not found — run: pnpm exec werkstatt run fleet.claims.init --remote <url>`,
    );
  }
  const clonePath = await ensureClaimsClone(werkstattRoot, config);

  const claim = await buildClaim(input);
  const claimsDir = path.join(clonePath, "claims");
  await mkdir(claimsDir, { recursive: true });
  const claimPath = path.join(claimsDir, `${systemId}.json`);
  await writeFile(claimPath, JSON.stringify(claim, null, 2) + "\n", "utf8");

  git(clonePath, ["add", `claims/${systemId}.json`]);
  const hasStaged = !gitOk(clonePath, ["diff", "--cached", "--quiet"]);
  let commit = gitOk(clonePath, ["rev-parse", "HEAD"]) ? git(clonePath, ["rev-parse", "HEAD"]) : "";
  if (hasStaged) {
    git(clonePath, [
      "-c",
      "user.name=werkstatt-fleet-claims",
      "-c",
      "user.email=fleet-claims@werkstatt.local",
      "commit",
      "-m",
      `claim: ${systemId} ${claim.passportHash.slice(0, 16)}`,
    ]);
    commit = git(clonePath, ["rev-parse", "HEAD"]);
  }

  const pushErrors: string[] = [];
  if (input.push !== false) {
    for (let i = 0; i < config.remotes.length; i++) {
      try {
        git(clonePath, ["push", remoteName(i), "HEAD:refs/heads/main"]);
      } catch (err) {
        pushErrors.push(
          `${remoteName(i)}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
        );
      }
    }
  }

  return {
    claim,
    claimPath,
    commit,
    pushed: pushErrors.length === 0 && config.remotes.length > 0 && input.push !== false,
    pushErrors,
  };
}

/**
 * Sender-side transfer claim (RFC-1124): after a handover completes on the
 * recipient's side and the bordbuch event + new passport propagate back to the
 * sender's clone, the OUTGOING creator publishes a transfer claim — signed by
 * the old key, describing the new owner, bound to the authorization via
 * authorizationHash. This completes the registry transfer even when the
 * recipient's workshop never publishes (offline, no claims config).
 *
 * Returns null when there is nothing to do: no handover event, the current
 * claim already covers the new passport, the local passport has not caught up,
 * or our key is not the outgoing creator's.
 */
export async function publishPendingTransferClaim(input: {
  systemId: string;
  werkstattRoot: string;
  signerPrivateKeyHex: string;
  signerPublicKey: string;
  push?: boolean;
}): Promise<PublishClaimResult | null> {
  const { systemId, werkstattRoot, signerPublicKey } = input;
  const config = await loadFleetClaimsConfig(werkstattRoot);
  if (!config) return null;
  const clonePath = claimsClonePath(werkstattRoot, config);
  if (!existsSync(path.join(clonePath, ".git"))) return null;

  // Latest handover event in the system bordbuch.
  const entries = await readBordbuch(werkstattRoot, systemId).catch(() => []);
  const handover = [...entries].reverse().find((e) => e.kind === "handover");
  if (!handover) return null;
  const meta = handover.metadata as Record<string, unknown> | undefined;
  const newPassportHash = meta?.newPassportHash as string | undefined;
  const authorizationHash = meta?.authorizationHash as string | undefined;
  if (!newPassportHash || !authorizationHash) return null;

  // The new passport must be visible locally — otherwise buildClaim would
  // describe the OLD passport and produce a self-claim refresh, not a transfer.
  const passport = await readPassport(werkstattRoot, systemId).catch(() => null);
  if (!passport || passport.passportHash !== newPassportHash) return null;

  // Current local claim must exist, must be ours (we are the outgoing
  // creator), and must not already cover the new passport.
  const local = readClaimFile(path.join(clonePath, "claims", `${systemId}.json`));
  if (!local) return null;
  if (local.passportHash === newPassportHash) return null; // already claimed
  if (local.instanceId !== deriveInstanceId(signerPublicKey)) return null; // not outgoing creator

  return publishClaim({ ...input, authorizationHash });
}

// ---------------------------------------------------------------------------
// Verify (offline)
// ---------------------------------------------------------------------------

function readClaimFile(filePath: string): FleetClaim | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(execFileSync("cat", [filePath], { encoding: "utf8" })) as FleetClaim;
  } catch {
    return null;
  }
}

function claimAtRef(clonePath: string, ref: string, systemId: string): FleetClaim | null {
  try {
    const raw = git(clonePath, ["show", `${ref}:claims/${systemId}.json`]);
    return JSON.parse(raw) as FleetClaim;
  } catch {
    return null;
  }
}

/** Previous version of the claim file on the given ref (second commit back). */
function previousClaimAtRef(clonePath: string, ref: string, systemId: string): FleetClaim | null {
  try {
    const commits = git(clonePath, ["log", "--format=%H", ref, "--", `claims/${systemId}.json`])
      .split("\n")
      .filter(Boolean);
    if (commits.length < 2) return null;
    const raw = git(clonePath, ["show", `${commits[1]}:claims/${systemId}.json`]);
    return JSON.parse(raw) as FleetClaim;
  } catch {
    return null;
  }
}

function remoteRefs(clonePath: string): string[] {
  if (!gitOk(clonePath, ["for-each-ref", "--format=%(refname)", "refs/remotes/"])) return [];
  return git(clonePath, ["for-each-ref", "--format=%(refname)", "refs/remotes/"])
    .split("\n")
    .filter(Boolean);
}

/**
 * LWW + owner-signature precedence, ported from kernel/dht/register.ts
 * resolveConflict: newer claimedAt wins; on equal timestamps a self-claim
 * (owner signature) beats a transfer claim; otherwise the existing claim wins
 * (conservative, no flapping).
 */
export function resolveClaimConflict(
  existing: FleetClaim,
  candidate: FleetClaim,
): { winner: FleetClaim; reason: "newer" | "self-claim" | "equal-existing" } {
  const existingTime = new Date(existing.claimedAt).getTime();
  const candidateTime = new Date(candidate.claimedAt).getTime();

  if (candidateTime > existingTime) {
    return { winner: candidate, reason: "newer" };
  }
  if (candidateTime === existingTime) {
    const existingIsSelf = deriveInstanceId(existing.signerPublicKey) === existing.instanceId;
    const candidateIsSelf = deriveInstanceId(candidate.signerPublicKey) === candidate.instanceId;
    if (candidateIsSelf && !existingIsSelf) {
      return { winner: candidate, reason: "self-claim" };
    }
  }
  return { winner: existing, reason: "equal-existing" };
}

async function isLegitimateClaim(
  claim: FleetClaim,
  previous: FleetClaim | null,
  werkstattRoot: string,
): Promise<boolean> {
  const signerInstance = deriveInstanceId(claim.signerPublicKey);
  if (signerInstance === claim.instanceId) return true; // self-claim

  // Transfer claim: signer must be the previous claim's creator AND a bordbuch
  // handover event must link authorizationHash → newPassportHash.
  if (!previous || previous.instanceId !== signerInstance) return false;
  if (!claim.authorizationHash) return false;

  try {
    const entries = await readBordbuch(werkstattRoot, claim.systemId);
    return entries.some(
      (e) =>
        e.kind === "handover" &&
        (e.metadata as Record<string, unknown> | undefined)?.authorizationHash ===
          claim.authorizationHash &&
        (e.metadata as Record<string, unknown> | undefined)?.newPassportHash === claim.passportHash,
    );
  } catch {
    return false;
  }
}

/**
 * Resolve the current claim for a system entirely offline: local claim file +
 * diverged claims on remote-tracking refs → signature check → legitimacy →
 * LWW → verdict. Never fetches, never writes.
 */
export async function verifyClaimOffline(input: {
  systemId: string;
  werkstattRoot: string;
}): Promise<ClaimsVerifyResult> {
  const { systemId, werkstattRoot } = input;
  const result: ClaimsVerifyResult = {
    systemId,
    claim: null,
    verdict: "no-claim",
    conflicts: [],
  };

  const config = await loadFleetClaimsConfig(werkstattRoot);
  if (!config) return result;
  const clonePath = claimsClonePath(werkstattRoot, config);
  if (!existsSync(path.join(clonePath, ".git"))) return result;

  // Candidates: local file + every diverged remote-ref version.
  const candidates: Array<{ claim: FleetClaim; ref: string }> = [];
  const local = readClaimFile(path.join(clonePath, "claims", `${systemId}.json`));
  if (local) candidates.push({ claim: local, ref: "HEAD" });

  const seen = new Set<string>(local ? [JSON.stringify(local)] : []);
  for (const ref of remoteRefs(clonePath)) {
    const remote = claimAtRef(clonePath, ref, systemId);
    if (remote && !seen.has(JSON.stringify(remote))) {
      seen.add(JSON.stringify(remote));
      candidates.push({ claim: remote, ref });
    }
  }

  if (candidates.length === 0) return result;

  // Signature + legitimacy filter.
  const valid: Array<{ claim: FleetClaim; ref: string }> = [];
  for (const c of candidates) {
    const sigOk = await verifyClaimSignature(c.claim).catch(() => false);
    if (!sigOk) continue;
    const previous = previousClaimAtRef(clonePath, c.ref, systemId);
    if (await isLegitimateClaim(c.claim, previous, werkstattRoot)) {
      valid.push(c);
    }
  }

  if (valid.length === 0) {
    result.claim = local ?? candidates[0].claim;
    result.verdict = "invalid-signature";
    return result;
  }

  // LWW across valid candidates.
  let winner = valid[0].claim;
  for (const c of valid.slice(1)) {
    const res = resolveClaimConflict(winner, c.claim);
    if (res.winner !== winner) {
      result.conflicts.push({ claim: winner, reason: `lost-lww:${res.reason}` });
      winner = res.winner;
    } else {
      result.conflicts.push({ claim: c.claim, reason: `lost-lww:${res.reason}` });
    }
  }

  result.claim = winner;

  // Verdict on the winner.
  if (winner.supersededBy !== null) {
    result.verdict = "stale";
    return result;
  }
  const passport = await readPassport(werkstattRoot, systemId).catch(() => null);
  if (passport && passport.passportHash !== winner.passportHash) {
    result.verdict = "stale";
    return result;
  }
  result.verdict = "valid";
  return result;
}

// ---------------------------------------------------------------------------
// Sync + status
// ---------------------------------------------------------------------------

/**
 * Fetch every configured remote into remote-tracking refs, fast-forward the
 * local clone when possible, record diverged claim files (never auto-merge),
 * verify all local claim signatures, and push pending commits.
 */
export async function syncClaims(werkstattRoot: string): Promise<SyncClaimsResult> {
  const result: SyncClaimsResult = {
    fetched: [],
    fastForwarded: false,
    pushed: false,
    diverged: [],
    invalidClaims: [],
    errors: [],
  };

  const config = await loadFleetClaimsConfig(werkstattRoot);
  if (!config) {
    result.errors.push(`${CONFIG_FILE} not found — run fleet.claims.init first`);
    return result;
  }
  const clonePath = await ensureClaimsClone(werkstattRoot, config);

  // Fetch all remotes.
  for (let i = 0; i < config.remotes.length; i++) {
    const name = remoteName(i);
    try {
      git(clonePath, ["fetch", name, `+refs/heads/*:refs/remotes/${name}/*`]);
      result.fetched.push(name);
    } catch (err) {
      result.errors.push(
        `fetch ${name}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      );
    }
  }

  // Fast-forward local main to the best remote state; record divergence.
  const hasHead = gitOk(clonePath, ["rev-parse", "HEAD"]);
  for (const ref of remoteRefs(clonePath)) {
    if (!hasHead) {
      // No local commits — adopt the remote ref wholesale.
      git(clonePath, ["checkout", "-B", "main", ref]);
      result.fastForwarded = true;
      break;
    }
    if (gitOk(clonePath, ["merge-base", "--is-ancestor", "HEAD", ref])) {
      git(clonePath, ["merge", "--ff-only", ref]);
      result.fastForwarded = true;
    } else if (!gitOk(clonePath, ["merge-base", "--is-ancestor", ref, "HEAD"])) {
      const files = gitOk(clonePath, ["diff", "--name-only", "HEAD", ref, "--", "claims/"])
        ? git(clonePath, ["diff", "--name-only", "HEAD", ref, "--", "claims/"])
            .split("\n")
            .filter(Boolean)
        : [];
      result.diverged.push({ remote: ref, files });
    }
    // ref is ancestor of HEAD — local ahead, nothing to pull.
  }

  // Verify all local claim signatures.
  const claimsDir = path.join(clonePath, "claims");
  if (existsSync(claimsDir)) {
    const { readdir } = await import("node:fs/promises");
    for (const file of await readdir(claimsDir)) {
      if (!file.endsWith(".json")) continue;
      const claim = readClaimFile(path.join(claimsDir, file));
      if (!claim || !(await verifyClaimSignature(claim).catch(() => false))) {
        result.invalidClaims.push(file);
      }
    }
  }

  // Push pending commits.
  let pushFailed = false;
  for (let i = 0; i < config.remotes.length; i++) {
    try {
      git(clonePath, ["push", remoteName(i), "HEAD:refs/heads/main"]);
    } catch (err) {
      pushFailed = true;
      result.errors.push(
        `push ${remoteName(i)}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      );
    }
  }
  result.pushed = config.remotes.length > 0 && !pushFailed;

  await writeFile(
    path.join(werkstattRoot, STATE_FILE),
    JSON.stringify({ lastSyncAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );

  return result;
}

/** Local clone vs remote state, pending unpushed claims, last sync. */
export async function claimsStatus(werkstattRoot: string): Promise<ClaimsStatusResult> {
  const result: ClaimsStatusResult = {
    configured: false,
    clonePath: null,
    remotes: [],
    claims: 0,
    unpushedCommits: 0,
    behindRemotes: [],
    lastSyncAt: null,
  };

  const config = await loadFleetClaimsConfig(werkstattRoot);
  if (!config) return result;
  result.configured = true;
  result.remotes = config.remotes;

  const clonePath = claimsClonePath(werkstattRoot, config);
  if (!existsSync(path.join(clonePath, ".git"))) return result;
  result.clonePath = clonePath;

  const claimsDir = path.join(clonePath, "claims");
  if (existsSync(claimsDir)) {
    const { readdir } = await import("node:fs/promises");
    result.claims = (await readdir(claimsDir)).filter((f) => f.endsWith(".json")).length;
  }

  for (const ref of remoteRefs(clonePath)) {
    const behind = gitOk(clonePath, ["rev-list", "--count", `HEAD..${ref}`])
      ? Number.parseInt(git(clonePath, ["rev-list", "--count", `HEAD..${ref}`]), 10)
      : 0;
    const ahead = gitOk(clonePath, ["rev-list", "--count", `${ref}..HEAD`])
      ? Number.parseInt(git(clonePath, ["rev-list", "--count", `${ref}..HEAD`]), 10)
      : 0;
    if (behind > 0) result.behindRemotes.push({ remote: ref, behind });
    result.unpushedCommits = Math.max(result.unpushedCommits, ahead);
  }
  // No remote refs yet — count all local commits as unpushed.
  if (remoteRefs(clonePath).length === 0 && gitOk(clonePath, ["rev-list", "--count", "HEAD"])) {
    result.unpushedCommits = Number.parseInt(git(clonePath, ["rev-list", "--count", "HEAD"]), 10);
  }

  const statePath = path.join(werkstattRoot, STATE_FILE);
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(await readFile(statePath, "utf8")) as { lastSyncAt?: string };
      result.lastSyncAt = state.lastSyncAt ?? null;
    } catch {
      // corrupt state file — ignore
    }
  }

  return result;
}

/** sha256 helper for claim content addressing (diagnostics). */
export function claimContentHash(claim: FleetClaim): string {
  return createHash("sha256").update(JSON.stringify(claim), "utf8").digest("hex");
}
