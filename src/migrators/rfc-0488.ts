/*
<MODULE_CONTRACT>
<purpose>RFC-0488: material credits provenance registry migrator — transforms
existing *.credits.yaml sidecars by adding status, usageBasis, and aiUsage fields.
Makes existing sidecars compatible with the extended materialCreditSchema.</purpose>
<non-goals>
  <item>Does not validate credit records — that is the job of material.credits.validate.</item>
  <item>Does not modify labels.md — labels are operator-authored content.</item>
  <item>Does not delete or rename sidecar files — only transforms their content.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0488: initial migrator — add status, usageBasis, aiUsage to existing credit sidecars.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";

export const RFC_0488_MIGRATOR_ID = "rfc-0488";

const DEFAULT_COPYRIGHT_NOTICE = "Copyright © Warpgogol. All rights reserved.";
const DEFAULT_HUMAN_CONTRIBUTION =
  "Konzeption, Auswahl, Zusammenstellung und Nachbearbeitung durch Warpgogol";

interface CreditParty {
  role: string;
  name: string;
  kind: string;
}

interface CreditRecord {
  id: string;
  sourceType: string;
  parties: CreditParty[];
  license?: { label?: string; copyrightNotice?: string };
  status?: string;
  usageBasis?: unknown;
  aiUsage?: unknown;
  [key: string]: unknown;
}

function hasPersonCreator(record: CreditRecord): boolean {
  return record.parties.some(
    (p) => (p.role === "creator" || p.role === "coCreator") && p.kind === "Person",
  );
}

function hasNonDefaultCopyrightNotice(record: CreditRecord): boolean {
  const notice = record.license?.copyrightNotice;
  return notice !== undefined && notice !== DEFAULT_COPYRIGHT_NOTICE;
}

function determineCopyrightClaimed(record: CreditRecord): boolean {
  // If there's a Person creator or a non-default copyright notice, claim copyright.
  // Otherwise, don't claim — the default notice was auto-applied and is legally
  // incorrect for AI-generated materials without human creative contribution.
  return hasPersonCreator(record) || hasNonDefaultCopyrightNotice(record);
}

function transformRecord(record: CreditRecord): CreditRecord {
  // 1. Add status: active if not present
  if (!record.status) {
    record.status = "active";
  }

  // 2. For ai-generated records with default copyright notice: add aiUsage
  if (
    (record.sourceType === "ai-generated" || record.sourceType === "ai-assisted") &&
    !record.aiUsage
  ) {
    record.aiUsage = {
      kind: record.sourceType,
      humanContribution: DEFAULT_HUMAN_CONTRIBUTION,
      copyrightClaimed: determineCopyrightClaimed(record),
    };
  }

  // 3. For third-party/screenshot records: add unverified usageBasis
  // Also detect license.label "screenshot-of-linked-public-source" and map sourceType to "screenshot"
  if (
    record.license?.label === "screenshot-of-linked-public-source" &&
    record.sourceType !== "screenshot"
  ) {
    record.sourceType = "screenshot";
  }
  if (
    (record.sourceType === "third-party" ||
      record.sourceType === "licensed-third-party" ||
      record.sourceType === "screenshot") &&
    !record.usageBasis
  ) {
    record.usageBasis = {
      type: "unverified",
      note: "Rights review required",
    };
  }

  // 4. For commissioned records: add internal-commissioned usageBasis
  if (record.sourceType === "commissioned" && !record.usageBasis) {
    record.usageBasis = {
      type: "internal-commissioned",
    };
  }

  // 5. For human-made records with Organization creator: rename role to commissionedBy
  if (record.sourceType === "human-made") {
    for (const party of record.parties) {
      if (party.role === "creator" && party.kind === "Organization") {
        party.role = "commissionedBy";
      }
    }
    // If no Person creator remains, flag as needs-review
    if (!hasPersonCreator(record) && record.status === "active") {
      record.status = "needs-review";
    }
  }

  return record;
}

async function findCreditsFiles(rootPath: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        await walk(fullPath);
      } else if (entry.endsWith(".credits.yaml")) {
        results.push(fullPath);
      }
    }
  }

  const contentDir = path.join(rootPath, "src", "content");
  await walk(contentDir);
  return results;
}

async function transformCreditsFiles(
  data: SternsystemData,
  ctx: MigrationContext,
): Promise<SternsystemData> {
  const files = await findCreditsFiles(data.rootPath);

  for (const filePath of files) {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      ctx.logger.info(`[migrator rfc-0488] skip unreadable file: ${filePath}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new MigrationError(
        RFC_0488_MIGRATOR_ID,
        filePath,
        "",
        `failed to parse YAML: ${(err as Error).message}`,
      );
    }

    if (!parsed || typeof parsed !== "object") {
      ctx.logger.info(`[migrator rfc-0488] skip non-object file: ${filePath}`);
      continue;
    }

    const record = parsed as CreditRecord;
    const before = JSON.stringify(record);
    transformRecord(record);
    const after = JSON.stringify(record);

    if (before !== after) {
      const output = stringifyYaml(record);
      await fs.writeFile(filePath, output, "utf8");
      ctx.logger.info(`[migrator rfc-0488] transformed: ${path.relative(data.rootPath, filePath)}`);
    }
  }

  return data;
}

export const rfc0488Migrator: Migrator = {
  id: RFC_0488_MIGRATOR_ID,
  fromVersion: "4.6.0",
  toVersion: "4.7.0",
  description: "Add status, usageBasis, and aiUsage fields to existing material credit sidecars",
  transform: async (data, ctx) => {
    return transformCreditsFiles(data, ctx);
  },
};
