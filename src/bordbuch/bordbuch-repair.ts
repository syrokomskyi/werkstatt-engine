/*
<MODULE_CONTRACT>
  <purpose>RFC-0583: bordbuch.repair — detect orphan-mission-close violations, insert missing mission-open events, recompute hash chain and event-id sequence, write atomically.</purpose>
  <non-goals>
    <item>Do not repair duplicate-mission-id, sensitive-payload, hash-mismatch, or hash-chain-gap violations — these are unrepairable by this command.</item>
    <item>Do not add bordbuch.repair to any pipeline — it is an on-demand operator command.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0583: initial bordbuch.repair command handler.</item>
  <item>Bug fix: auto-commit repaired bordbuch to prevent dirty cache clone blocking mission.open; throw on commit failure.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";
import {
  readBordbuch,
  validateBordbuch,
  computeEntryHash,
  resolveBordbuchPath,
  commitAndPushBordbuch,
} from "./bordbuch-io.ts";
import { resolveCacheClonePath } from "../sternsystem/registry-io.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import { atomicWriteFile } from "../werkstatt/atomic.ts";

export interface BordbuchRepairOrphan {
  missionId: string;
  closeEventId: string;
  closeEventKind: "mission-close" | "mission-abort";
  proposedOpen: Omit<BordbuchEntry, "hash" | "id" | "previousHash">;
  metadataSource: "auto-derived" | "operator-supplied";
}

export interface BordbuchRepairResult {
  systemId: string;
  insertedEvents: number;
  recomputedHashes: number;
  repairedFilePath: string;
  dryRun: boolean;
  orphans?: BordbuchRepairOrphan[];
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBoolean(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

const UNREPAIRABLE_RULES = new Set([
  "duplicate-mission-id",
  "sensitive-payload",
  "hash-mismatch",
  "hash-chain-gap",
  "event-id-gap",
  "unmatched-mission-open",
]);

function entriesToNdjson(entries: BordbuchEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export async function runBordbuchRepair(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<BordbuchRepairResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const dryRun = flagBoolean(input, "dry-run");
  const missionFilter = flagString(input, "mission");
  const metadataStr = flagString(input, "metadata");

  if (!systemId) throw new Error("[bordbuch.repair] --system is required");

  let operatorMetadata: { occurredAt?: string; summary?: string; actor?: string } | undefined;
  if (metadataStr) {
    try {
      operatorMetadata = JSON.parse(metadataStr);
    } catch {
      throw new Error("[bordbuch.repair] --metadata must be valid JSON");
    }
  }

  const operationId = generateOperationId();
  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "bordbuch.repair", "agent");
  await acquireLock(workspaceRoot, `bordbuch:${systemId}`, operationId, "bordbuch.repair", "agent");

  try {
    const entries = await readBordbuch(workspaceRoot, systemId);
    const { violations } = await validateBordbuch(workspaceRoot, systemId);
    const filePath = await resolveBordbuchPath(workspaceRoot, systemId);

    if (violations.length === 0) {
      logger.info(`[bordbuch.repair] ${systemId}: no repairs needed`);
      return {
        data: {
          systemId,
          insertedEvents: 0,
          recomputedHashes: 0,
          repairedFilePath: filePath,
          dryRun,
        },
        summary: `[bordbuch.repair] ${systemId}: no repairs needed`,
      };
    }

    const orphanViolations = violations.filter((v) => v.rule === "orphan-mission-close");
    const unrepairable = violations.filter((v) => UNREPAIRABLE_RULES.has(v.rule));

    if (unrepairable.length > 0) {
      const messages = unrepairable.map((v) => `[${v.rule}] ${v.message}`).join("; ");
      throw new Error(
        `[bordbuch.repair] unrepairable violations found: ${messages}. These require manual intervention.`,
      );
    }

    if (orphanViolations.length === 0) {
      throw new Error(
        `[bordbuch.repair] no orphan-mission-close violations found. Other violations require manual intervention.`,
      );
    }

    const orphans: BordbuchRepairOrphan[] = [];
    const insertions: Array<{ index: number; entry: BordbuchEntry }> = [];

    for (const violation of orphanViolations) {
      const closeEntry = entries.find((e) => e.id === violation.eventId);
      if (!closeEntry || !closeEntry.missionId) continue;

      if (missionFilter && closeEntry.missionId !== missionFilter) continue;

      const occurredAt = operatorMetadata?.occurredAt ?? closeEntry.occurredAt;
      const summary = operatorMetadata?.summary ?? "Mission opened (auto-repaired)";
      const actor = operatorMetadata?.actor ?? "agent";

      const proposedOpen: Omit<BordbuchEntry, "hash" | "id" | "previousHash"> = {
        schemaVersion: "1.0.0",
        systemId,
        occurredAt,
        kind: "mission-open",
        status: "done",
        missionId: closeEntry.missionId,
        releaseId: null,
        actor,
        summary,
        metadata: { autoRepaired: true },
      };

      orphans.push({
        missionId: closeEntry.missionId,
        closeEventId: closeEntry.id,
        closeEventKind: closeEntry.kind as "mission-close" | "mission-abort",
        proposedOpen,
        metadataSource: operatorMetadata ? "operator-supplied" : "auto-derived",
      });

      const closeIndex = entries.indexOf(closeEntry);
      const openEntry: BordbuchEntry = {
        ...proposedOpen,
        id: "event-000000",
        previousHash: null,
        hash: "sha256:placeholder",
      };
      insertions.push({ index: closeIndex, entry: openEntry });
    }

    if (missionFilter && orphans.length === 0) {
      throw new Error(
        `[bordbuch.repair] no orphan-mission-close violations found for mission '${missionFilter}'.`,
      );
    }

    const repairedEntries: BordbuchEntry[] = [];
    let insertIdx = 0;
    for (let i = 0; i < entries.length; i++) {
      while (insertIdx < insertions.length && insertions[insertIdx].index === i) {
        repairedEntries.push(insertions[insertIdx].entry);
        insertIdx++;
      }
      repairedEntries.push(entries[i]);
    }
    while (insertIdx < insertions.length) {
      repairedEntries.push(insertions[insertIdx].entry);
      insertIdx++;
    }

    let prevHash: string | null = null;
    for (let i = 0; i < repairedEntries.length; i++) {
      const id = `event-${String(i + 1).padStart(6, "0")}`;
      const { hash: _oldHash, id: _oldId, previousHash: _oldPrev, ...rest } = repairedEntries[i];
      const entryWithoutHash: Omit<BordbuchEntry, "hash"> = {
        ...rest,
        id,
        previousHash: prevHash,
      };
      const hash = computeEntryHash(entryWithoutHash);
      repairedEntries[i] = { ...entryWithoutHash, hash };
      prevHash = hash;
    }

    const recomputedHashes = repairedEntries.length;
    const originalContent = existsSync(filePath) ? await fs.readFile(filePath, "utf8") : "";
    const repairedNdjson = entriesToNdjson(repairedEntries);

    await atomicWriteFile(filePath, repairedNdjson);

    const { violations: postViolations } = await validateBordbuch(workspaceRoot, systemId);

    if (postViolations.length > 0) {
      await atomicWriteFile(filePath, originalContent);
      const messages = postViolations.map((v) => `[${v.rule}] ${v.message}`).join("; ");
      throw new Error(
        `[bordbuch.repair] repaired bordbuch still invalid: ${messages}. File not written.`,
      );
    }

    if (dryRun) {
      await atomicWriteFile(filePath, originalContent);
      logger.info(`[bordbuch.repair] ${systemId}: dry-run — ${orphans.length} repair(s) planned`);
      return {
        data: {
          systemId,
          insertedEvents: 0,
          recomputedHashes: 0,
          repairedFilePath: filePath,
          dryRun: true,
          orphans,
        },
        summary: `[bordbuch.repair] ${systemId}: dry-run — ${orphans.length} repair(s) planned`,
        nextSteps: [
          {
            action: `Apply repairs: pnpm exec werkstatt run bordbuch.repair --site ${systemId}`,
            kind: "optional",
          },
        ],
      };
    }

    const cacheCloneDir = await resolveCacheClonePath(workspaceRoot, systemId);
    if (existsSync(path.join(cacheCloneDir, ".git"))) {
      const commitResult = await commitAndPushBordbuch(
        cacheCloneDir,
        `bordbuch.repair: ${systemId} — auto-repair ${orphans.length} orphan-mission-close event(s)`,
      );
      if (!commitResult.commitSha) {
        throw new Error(
          `[bordbuch.repair] ${systemId}: bordbuch file written but commit failed — cache clone has unstaged changes. ` +
            `Error: ${commitResult.error ?? "unknown"}. ` +
            `Check git state in the cache clone and re-run bordbuch.repair.`,
        );
      }
    }

    logger.success(
      `[bordbuch.repair] ${systemId}: inserted ${orphans.length} mission-open event(s), recomputed ${recomputedHashes} hashes`,
    );

    return {
      data: {
        systemId,
        insertedEvents: orphans.length,
        recomputedHashes,
        repairedFilePath: filePath,
        dryRun: false,
      },
      summary: `[bordbuch.repair] ${systemId}: inserted ${orphans.length} mission-open event(s), recomputed ${recomputedHashes} hashes`,
      nextSteps: [],
    };
  } finally {
    await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }
}
