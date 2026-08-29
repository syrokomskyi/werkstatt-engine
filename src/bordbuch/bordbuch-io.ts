/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/bordbuch/bordbuch-io.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Does not define mission lifecycle — that lives in the mission module.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial Bordbuch hash-chain helpers.</item>
  <item>RFC-0473: add runtime writer-role for pseo and indexnow.submit kinds.</item>
  <item>RFC-0477: add commitAndPushBordbuch helper for git commit+push after bordbuch append.</item>
  <item>RFC-0574: resolveBordbuchPath uses resolveCachePath (mirrors[0].path) instead of hardcoded systems/<id>/.</item>
  <item>RFC-0580: extract gitExec into shared werkstatt/git-exec.ts with allowNonZero option.</item>
  <item>RFC-0583: export computeEntryHash for reuse by bordbuch.repair.</item>
  <item>RFC-0706: add nachweis writer-role for nachweis-record and nachweis-consent kinds (ADR-0028).</item>
  <item>RFC-0715: add nachweis-signed and nachweis-timestamped to nachweis writer-role for N3 crypto verification.</item>
  <item>RFC-0724: add DEPRECATED_KIND_MIGRATIONS for forward-only kind renames (release-published -> release-ready).</item>
  <item>Bug fix: guard against duplicate mission-close/abort events for the same missionId in appendBordbuchEntry.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  bordbuchEntrySchema,
  type BordbuchEntry,
  type BordbuchEntryKind,
} from "@warpgogol/werkstatt-engine/schemas";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import { resolveCacheClonePath, resolveActiveWorkpieceDir } from "../sternsystem/registry-io.ts";
import { gitExec } from "../werkstatt/git-exec.ts";
import { cacheCloneCommit } from "../mission/mission-git-commit.ts";

const BORDBUCH_PATH = path.join("bordbuch", "events.ndjson");

export async function resolveBordbuchPath(
  workspaceRoot: string,
  systemId: string,
): Promise<string> {
  const cachePath = resolveCacheClonePath(workspaceRoot, systemId);
  return path.join(cachePath, BORDBUCH_PATH);
}

/**
 * Workpiece-aware: during an active mission, bordbuch projections (bordbuch.json,
 * bordbuch/index.html, status.generated.yaml) must be written to the workpiece
 * directory so that astro build includes them in the site output. Without this,
 * projections land in the cache clone and are invisible to the build — the same
 * circular dependency pattern as resolveNachweisCachePath.
 *
 * The bordbuch ledger itself (events.ndjson) stays in the cache clone — it is
 * an append-only artifact, not a workpiece file. Only the generated projections
 * need to be workpiece-aware.
 */
export async function resolveBordbuchProjectionDir(
  workspaceRoot: string,
  systemId: string,
): Promise<string> {
  const workpieceDir = await resolveActiveWorkpieceDir(workspaceRoot, systemId);
  if (workpieceDir) return workpieceDir;
  return resolveCacheClonePath(workspaceRoot, systemId);
}

const WRITER_ROLE_KINDS: Record<string, BordbuchEntryKind[]> = {
  mission: [
    "mission-open",
    "mission-close",
    "mission-abort",
    "mission-open-rolled-back",
    "preflight-skipped",
  ],
  release: ["release-ready", "release-rolled-back"],
  sternsystem: ["pin-update"],
  leitstand: ["deployment"],
  notausgang: ["notausgang-export"],
  operator: ["operator-note", "erratum"],
  runtime: ["pseo", "indexnow.submit"],
  // RFC-0706 / ADR-0028: Nachweisregister trust lifecycle
  // RFC-0715: N3 cryptographic verification (operator signature + RFC 3161 timestamp)
  // RFC-0888: Sichtpass lifecycle audit trail
  nachweis: [
    "nachweis-record",
    "nachweis-consent",
    "nachweis-signed",
    "nachweis-timestamped",
    "sichtpass",
  ],
};

export function validateWriterRole(writerRole: string, kind: BordbuchEntryKind): boolean {
  const allowed = WRITER_ROLE_KINDS[writerRole];
  return allowed ? allowed.includes(kind) : false;
}

/**
 * RFC-0724: Forward-only migration map for deprecated bordbuch entry kinds.
 * When a kind is renamed (e.g. release-published -> release-ready), old entries
 * on disk still carry the deprecated value. readBordbuch normalizes them
 * before Zod parsing so validation doesn't crash on historical data.
 */
export const DEPRECATED_KIND_MIGRATIONS: Record<string, BordbuchEntryKind> = {
  "release-published": "release-ready",
};

/** Reverse map: current kind -> list of deprecated kinds that map to it. */
const KIND_MIGRATION_REVERSE: Record<string, string[]> = Object.entries(
  DEPRECATED_KIND_MIGRATIONS,
).reduce<Record<string, string[]>>((acc, [oldKind, newKind]) => {
  (acc[newKind] ??= []).push(oldKind);
  return acc;
}, {});

/** Normalize a deprecated kind to its current equivalent. Returns the kind unchanged if not deprecated. */
export function migrateDeprecatedKind(kind: string): string {
  return DEPRECATED_KIND_MIGRATIONS[kind] ?? kind;
}

const SENSITIVE_PATTERNS: RegExp[] = [
  /password/i,
  /secret/i,
  /token/i,
  /credential/i,
  /api[_-]?key/i,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  /\+?\d{1,4}[\s-]?\(?\d{1,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/,
];

export function containsSensitivePayload(text: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(text));
}

export function computeEntryHash(entry: Omit<BordbuchEntry, "hash">): string {
  const stable = JSON.stringify(entry, Object.keys(entry).sort());
  return `sha256:${createHash("sha256").update(stable).digest("hex")}`;
}

function nextEventId(entries: BordbuchEntry[]): string {
  const maxNum = entries.reduce((max, e) => {
    const m = e.id.match(/^event-(\d{6})$/);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);
  return `event-${String(maxNum + 1).padStart(6, "0")}`;
}

export async function readBordbuch(
  workspaceRoot: string,
  systemId: string,
): Promise<BordbuchEntry[]> {
  const filePath = await resolveBordbuchPath(workspaceRoot, systemId);
  if (!existsSync(filePath)) return [];
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const entries: BordbuchEntry[] = [];
  for (const line of lines) {
    const raw = JSON.parse(line) as Record<string, unknown>;
    if (typeof raw.kind === "string") {
      raw.kind = migrateDeprecatedKind(raw.kind);
    }
    const parsed = bordbuchEntrySchema.parse(raw);
    entries.push(parsed);
  }
  return entries;
}

export async function appendBordbuchEntry(
  workspaceRoot: string,
  systemId: string,
  kind: BordbuchEntryKind,
  summary: string,
  actor: string,
  options?: {
    missionId?: string | null;
    releaseId?: string | null;
    writerRole?: string;
    metadata?: Record<string, unknown>;
    status?: BordbuchEntry["status"];
    erratumOf?: string;
  },
): Promise<BordbuchEntry> {
  const filePath = await resolveBordbuchPath(workspaceRoot, systemId);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }

  if (containsSensitivePayload(summary)) {
    throw new Error(
      "[bordbuch.append] sensitive payload detected in summary — redact before appending",
    );
  }

  const entries = await readBordbuch(workspaceRoot, systemId);

  if ((kind === "mission-close" || kind === "mission-abort") && options?.missionId) {
    const existing = entries.find(
      (e) =>
        e.missionId === options.missionId &&
        (e.kind === "mission-close" || e.kind === "mission-abort"),
    );
    if (existing) {
      throw new Error(
        `[bordbuch.append] ${kind} already exists for mission '${options.missionId}' (event ${existing.id}) — duplicate mission lifecycle close is not allowed`,
      );
    }
  }

  // RFC-0968: duplicate handover rejection by authorizationHash
  if (kind === "handover" && options?.metadata) {
    const newAuthHash = (options.metadata as Record<string, unknown>).authorizationHash as
      string | undefined;
    if (newAuthHash) {
      const existing = entries.find(
        (e) =>
          e.kind === "handover" &&
          (e.metadata as Record<string, unknown> | undefined)?.authorizationHash === newAuthHash,
      );
      if (existing) {
        throw new Error(
          `[bordbuch.append] handover already exists for authorizationHash '${newAuthHash}' (event ${existing.id}) — duplicate handover is not allowed`,
        );
      }
    }
  }

  const previousHash = entries.length > 0 ? entries[entries.length - 1].hash : null;
  const id = nextEventId(entries);

  const entryWithoutHash: Omit<BordbuchEntry, "hash"> = {
    schemaVersion: "1.0.0",
    id,
    systemId,
    occurredAt: new Date().toISOString(),
    kind,
    status: options?.status ?? "done",
    missionId: options?.missionId ?? null,
    releaseId: options?.releaseId ?? null,
    actor,
    summary,
    metadata: options?.metadata,
    previousHash,
    erratumOf: options?.erratumOf,
  };

  const hash = computeEntryHash(entryWithoutHash);
  const entry: BordbuchEntry = { ...entryWithoutHash, hash };

  bordbuchEntrySchema.parse(entry);

  const line = JSON.stringify(entry) + "\n";
  const existingContent = existsSync(filePath) ? await fs.readFile(filePath, "utf8") : "";
  const separator = existingContent.length > 0 && !existingContent.endsWith("\n") ? "\n" : "";
  await atomicWriteFile(filePath, `${existingContent}${separator}${line}`);
  return entry;
}

export interface BordbuchViolation {
  rule: string;
  message: string;
  eventId?: string;
}

export async function validateBordbuch(
  workspaceRoot: string,
  systemId: string,
): Promise<{ entries: number; violations: BordbuchViolation[] }> {
  const entries = await readBordbuch(workspaceRoot, systemId);
  const violations: BordbuchViolation[] = [];

  let prevHash: string | null = null;
  let expectedId = 1;
  const openMissions = new Set<string>();
  const allMissionIds = new Set<string>();

  for (const entry of entries) {
    // Event id sequence
    const expectedIdStr = `event-${String(expectedId).padStart(6, "0")}`;
    if (entry.id !== expectedIdStr) {
      violations.push({
        rule: "event-id-gap",
        message: `expected id '${expectedIdStr}', got '${entry.id}'`,
        eventId: entry.id,
      });
    }
    expectedId++;

    // previousHash chain
    if (entry.previousHash !== prevHash) {
      violations.push({
        rule: "hash-chain-gap",
        message: `expected previousHash '${prevHash}', got '${entry.previousHash}'`,
        eventId: entry.id,
      });
    }

    // hash verification
    const { hash: _hash, ...entryWithoutHash } = entry;
    const computedHash = computeEntryHash(entryWithoutHash);
    // RFC-0724: also accept hashes computed with deprecated kind values
    const deprecatedAliases = KIND_MIGRATION_REVERSE[entry.kind] ?? [];
    const deprecatedHashes = deprecatedAliases.map((oldKind) =>
      computeEntryHash({ ...entryWithoutHash, kind: oldKind as BordbuchEntryKind }),
    );
    if (entry.hash !== computedHash && !deprecatedHashes.includes(entry.hash)) {
      violations.push({
        rule: "hash-mismatch",
        message: `hash mismatch for '${entry.id}'`,
        eventId: entry.id,
      });
    }

    prevHash = entry.hash;

    // Mission lifecycle pairing
    if (entry.kind === "mission-open") {
      if (entry.missionId && allMissionIds.has(entry.missionId)) {
        violations.push({
          rule: "duplicate-mission-id",
          message: `duplicate mission-open for '${entry.missionId}'`,
          eventId: entry.id,
        });
      }
      if (entry.missionId) {
        openMissions.add(entry.missionId);
        allMissionIds.add(entry.missionId);
      }
    } else if (
      entry.kind === "mission-close" ||
      entry.kind === "mission-abort" ||
      entry.kind === "mission-open-rolled-back"
    ) {
      if (entry.missionId && !openMissions.has(entry.missionId)) {
        violations.push({
          rule: "orphan-mission-close",
          message: `${entry.kind} for '${entry.missionId}' has no preceding mission-open`,
          eventId: entry.id,
        });
      }
      if (entry.missionId) {
        openMissions.delete(entry.missionId);
      }
    }

    // Sensitive payload guard
    if (containsSensitivePayload(entry.summary)) {
      violations.push({
        rule: "sensitive-payload",
        message: `sensitive payload detected in '${entry.id}'`,
        eventId: entry.id,
      });
    }
  }

  // Unmatched open missions — skip the currently active mission (state.currentMission)
  let currentMission: string | null = null;
  try {
    const { readSystemState } = await import("../sternsystem/registry-io.ts");
    const state = await readSystemState(workspaceRoot, systemId);
    currentMission = state.currentMission ?? null;
  } catch {
    // State not available — check all missions
  }
  for (const openId of openMissions) {
    if (openId === currentMission) continue;
    violations.push({
      rule: "unmatched-mission-open",
      message: `mission '${openId}' has mission-open but no mission-close or mission-abort`,
    });
  }

  return { entries: entries.length, violations };
}

export function deriveNextMissionNumber(entries: BordbuchEntry[]): number {
  let maxNum = 0;
  for (const entry of entries) {
    if (entry.kind === "mission-open" && entry.missionId) {
      const m = entry.missionId.match(/-m(\d{6})$/);
      if (m) {
        maxNum = Math.max(maxNum, parseInt(m[1], 10));
      }
    }
  }
  return maxNum + 1;
}

/**
 * Derive the next mission number, considering both Bordbuch entries AND
 * existing mission directories on disk. This prevents reusing a mission ID
 * from an aborted mission that was never recorded in the Bordbuch.
 */
export async function deriveNextMissionNumberSafe(
  entries: BordbuchEntry[],
  workspaceRoot: string,
  systemId: string,
): Promise<number> {
  let maxNum = 0;
  for (const entry of entries) {
    if (entry.kind === "mission-open" && entry.missionId) {
      const m = entry.missionId.match(/-m(\d{6})$/);
      if (m) {
        maxNum = Math.max(maxNum, parseInt(m[1], 10));
      }
    }
  }
  // Also scan existing mission directories on disk
  const missionsPath = path.join(workspaceRoot, "missions");
  if (existsSync(missionsPath)) {
    const dirs = await fs.readdir(missionsPath, { withFileTypes: true });
    for (const d of dirs) {
      if (d.name === "archive") continue;
      if (d.isSymbolicLink()) continue;
      if (!d.isDirectory()) continue;
      if (!d.name.startsWith(`${systemId}-m`)) continue;
      const m = d.name.match(/-m(\d{6})$/);
      if (m) {
        maxNum = Math.max(maxNum, parseInt(m[1], 10));
      }
    }
  }
  return maxNum + 1;
}

export interface CommitAndPushResult {
  commitSha: string | null;
  pushed: boolean;
  error: string | null;
}

export async function commitAndPushBordbuch(
  systemDir: string,
  message: string,
): Promise<CommitAndPushResult> {
  const bordbuchPath = path.join("bordbuch", "events.ndjson");
  const statusPath = path.join("bordbuch", "status.generated.yaml");

  try {
    gitExec(systemDir, `add ${bordbuchPath}`);
    // Also commit bordbuch/status.generated.yaml if it exists (RFC-0597 fix: prevent dirty cache clone)
    if (existsSync(path.join(systemDir, statusPath))) {
      try {
        gitExec(systemDir, `add ${statusPath}`);
      } catch {
        // status.generated.yaml may not exist or may be gitignored — non-fatal
      }
    }
  } catch {
    return { commitSha: null, pushed: false, error: null };
  }

  let commitSha: string | null = null;
  try {
    cacheCloneCommit(systemDir, message);
    commitSha = gitExec(systemDir, "rev-parse HEAD");
  } catch {
    return { commitSha: null, pushed: false, error: null };
  }

  // RFC-0987 Fix 4: resolve branch via symbolic-ref instead of rev-parse --abbrev-ref.
  // In detached HEAD, rev-parse returns "HEAD" which produces invalid refspecs.
  // symbolic-ref --short refs/remotes/origin/HEAD returns the remote default branch.
  let branch = "main";
  try {
    const ref = gitExec(systemDir, "symbolic-ref --short refs/remotes/origin/HEAD", {
      allowNonZero: true,
    });
    branch = ref.replace("origin/", "") || "main";
  } catch {
    // No remote HEAD set — default to main (same pattern as RFC-0981 writeSystemState)
  }

  let stashed = false;
  try {
    try {
      gitExec(systemDir, "stash push -m bordbuch-pull-rebase");
      stashed = true;
    } catch {
      // No changes to stash — proceed with pull
    }
    gitExec(systemDir, `pull --rebase origin ${branch}`);
    if (stashed) {
      try {
        gitExec(systemDir, "stash pop");
        stashed = false;
      } catch {
        // Stash pop failed — drop the stash to prevent accumulation.
        // The stashed changes are lost, but they were auto-generated
        // (bordbuch/status files) and will be recreated on next commit.
        try {
          gitExec(systemDir, "stash drop");
          stashed = false;
        } catch {
          // Stash may have been already popped — ignore
        }
      }
    }
    // RFC-0987 Fix 5: use --force-with-lease to safely overwrite diverged bare repo
    // history. The cache clone is the source of truth (RFC-0480); --force-with-lease
    // rejects the push if the remote HEAD changed unexpectedly.
    gitExec(systemDir, `push --force-with-lease origin ${branch}`);
    return { commitSha, pushed: true, error: null };
  } catch (err) {
    // RFC-0987 Fix 1: abort any in-progress rebase to prevent stale rebase-merge
    // state from blocking subsequent git operations (e.g. mission.open bordbuch.repair).
    try {
      gitExec(systemDir, "rebase --abort", { allowNonZero: true });
    } catch {
      // If git rebase --abort fails, manually remove the rebase state directories
      try {
        rmSync(path.join(systemDir, ".git", "rebase-merge"), { recursive: true, force: true });
      } catch {}
      try {
        rmSync(path.join(systemDir, ".git", "rebase-apply"), { recursive: true, force: true });
      } catch {}
    }
    // Clean up stash on push failure too
    if (stashed) {
      try {
        gitExec(systemDir, "stash drop");
      } catch {
        // Ignore — stash may not exist
      }
    }
    const stderr = (err as Error).message;
    return { commitSha, pushed: false, error: stderr };
  }
}
