/*
<MODULE_CONTRACT>
<purpose>
RFC-0564: CRDT genome log implementation. The genome log is a G-Set (Grow-Only
Set) of signed GenomeLogEntry records stored as append-only NDJSON in
werkstatt.genome.log. Provides append, read (with signature verification),
G-Set union merge, membership view derivation, Ed25519 signing, and file size
reporting for the 10MB threshold warning.
</purpose>
<non-goals>
  <item>Do not implement SWIM protocol gossip — that lives in handlers.ts.</item>
  <item>Do not implement config loading — that lives in config.ts.</item>
  <item>Do not implement compaction — that is a future RFC.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0564: initial implementation — G-Set genome log with Ed25519 signing, signature verification on read, set-union merge, and membership view derivation.</item>
</CHANGE_SUMMARY>
*/

import { readFile, appendFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { signBytes, verifyBytes } from "@warpgogol/werkstatt-shared/passport";
import type { GenomeLogEntry, SwimMembershipView, SwimMember, SwimMemberStatus } from "./types.ts";

const GENOME_LOG_FILENAME = "werkstatt.genome.log";
const GENOME_LOG_SIZE_THRESHOLD = 10 * 1024 * 1024;

function canonicalEntryBytes(entry: Omit<GenomeLogEntry, "signature">): Uint8Array {
  const canonical = JSON.stringify({
    workshopId: entry.workshopId,
    event: entry.event,
    timestamp: entry.timestamp,
    source: entry.source,
  });
  return new Uint8Array(Buffer.from(canonical, "utf8"));
}

export async function signGenomeEntry(
  entry: Omit<GenomeLogEntry, "signature">,
  privateKeyHex: string,
): Promise<GenomeLogEntry> {
  const signature = await signBytes(privateKeyHex, canonicalEntryBytes(entry));
  return { ...entry, signature };
}

export async function verifyGenomeEntry(
  entry: GenomeLogEntry,
  publicKeyMultibase: string,
): Promise<boolean> {
  const { signature, ...rest } = entry;
  return verifyBytes(publicKeyMultibase, canonicalEntryBytes(rest), signature);
}

export async function appendGenomeEntry(
  workspaceRoot: string,
  entry: GenomeLogEntry,
): Promise<void> {
  const logPath = join(workspaceRoot, GENOME_LOG_FILENAME);
  const line = JSON.stringify(entry) + "\n";
  await appendFile(logPath, line, "utf8");
}

export async function readGenomeLog(
  workspaceRoot: string,
  publicKeyMultibase?: string,
): Promise<{ entries: GenomeLogEntry[]; skipped: number }> {
  const logPath = join(workspaceRoot, GENOME_LOG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(logPath, "utf8");
  } catch {
    return { entries: [], skipped: 0 };
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const entries: GenomeLogEntry[] = [];
  let skipped = 0;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as GenomeLogEntry;
      if (publicKeyMultibase) {
        const valid = await verifyGenomeEntry(parsed, publicKeyMultibase);
        if (!valid) {
          skipped++;
          continue;
        }
      }
      entries.push(parsed);
    } catch {
      skipped++;
    }
  }

  return { entries, skipped };
}

function entryIdentity(entry: GenomeLogEntry): string {
  return `${entry.workshopId}|${entry.event}|${entry.timestamp}|${entry.source}`;
}

export function mergeGenomeLogs(local: GenomeLogEntry[], peer: GenomeLogEntry[]): GenomeLogEntry[] {
  const seen = new Set<string>();
  const result: GenomeLogEntry[] = [];
  for (const entry of [...local, ...peer]) {
    const id = entryIdentity(entry);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(entry);
    }
  }
  return result;
}

export function deriveMembershipView(entries: GenomeLogEntry[]): SwimMembershipView {
  const latestByWorkshop = new Map<string, GenomeLogEntry>();

  for (const entry of entries) {
    const existing = latestByWorkshop.get(entry.workshopId);
    if (!existing || entry.timestamp > existing.timestamp) {
      latestByWorkshop.set(entry.workshopId, entry);
    }
  }

  const members: SwimMember[] = [];
  let alive = 0;
  let suspect = 0;
  let dead = 0;

  for (const [workshopId, entry] of latestByWorkshop) {
    const status = entry.event as SwimMemberStatus;
    if (status === "alive") alive++;
    else if (status === "suspect") suspect++;
    else if (status === "dead") dead++;

    members.push({
      workshopId,
      endpoint: "",
      operatorVC: "",
      status,
      joinedAt: entry.timestamp,
      lastSeen: entry.timestamp,
    });
  }

  const total = members.length;
  return { members, total, alive, suspect, dead };
}

export async function getGenomeLogSize(workspaceRoot: string): Promise<number> {
  const logPath = join(workspaceRoot, GENOME_LOG_FILENAME);
  try {
    const stats = await stat(logPath);
    return stats.size;
  } catch {
    return 0;
  }
}

export function isGenomeLogSizeWarning(size: number): boolean {
  return size > GENOME_LOG_SIZE_THRESHOLD;
}

export { GENOME_LOG_FILENAME, GENOME_LOG_SIZE_THRESHOLD };
