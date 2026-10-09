/*
<MODULE_CONTRACT>
<purpose>RFC-0492: industry dossier schema migrator — transforms existing
industry records by copying deprecated fields to their new dossier equivalents
when the new field is absent. Three mechanical, idempotent transforms:
  1. proofSignals → trustSignals
  2. faqs → industryFaq
  3. painPoints → evidenceRequirements
Does NOT set notdienst (operator-authored content).</purpose>
<non-goals>
  <item>Do not delete deprecated fields — the baker falls back to them when new fields are absent.</item>
  <item>Do not set notdienst — that is operator-authored content.</item>
  <item>Do not validate industry records — that is surface.industry.validate.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0492: initial migrator — copy deprecated fields to new dossier equivalents.</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";
import {
  createDefaultIO,
  type FileStat,
  type WorkspaceIO,
} from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export const RFC_0492_MIGRATOR_ID = "rfc-0492";

const FIELD_MAPPINGS: Array<{ from: string; to: string }> = [
  { from: "proofSignals", to: "trustSignals" },
  { from: "faqs", to: "industryFaq" },
  { from: "painPoints", to: "evidenceRequirements" },
];

function transformFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  for (const { from, to } of FIELD_MAPPINGS) {
    if (data[to] === undefined && data[from] !== undefined) {
      data[to] = data[from];
    }
  }
  return data;
}

async function findIndustryFiles(rootPath: string): Promise<string[]> {
  const results: string[] = [];

  // fs.walk.lint: allow — walks via WorkspaceIO abstraction (io.readdir) — collectFiles has no io contract
  async function walk(dir: string, io: WorkspaceIO = createDefaultIO().io): Promise<void> {
    let entries: string[];
    try {
      entries = (await io.readdir(dir)).map((e) => e.name);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stat: FileStat;
      try {
        stat = await io.stat(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory) {
        await walk(fullPath);
      } else if (entry.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }

  const industriesDir = path.join(rootPath, "src", "content", "surface", "industries");
  await walk(industriesDir);
  return results;
}

async function transformIndustryFiles(
  data: SternsystemData,
  ctx: MigrationContext,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<SternsystemData> {
  const files = await findIndustryFiles(data.rootPath);

  for (const filePath of files) {
    let raw: string;
    try {
      raw = await io.readFile(filePath);
    } catch {
      ctx.logger.info(`[migrator rfc-0492] skip unreadable file: ${filePath}`);
      continue;
    }

    let frontmatter: Record<string, unknown> | null = null;
    let body = "";
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (fmMatch) {
      try {
        frontmatter = parseYaml(fmMatch[1]) as Record<string, unknown>;
      } catch (err) {
        throw new MigrationError(
          RFC_0492_MIGRATOR_ID,
          filePath,
          "",
          `failed to parse frontmatter YAML: ${(err as Error).message}`,
        );
      }
      body = fmMatch[2];
    }

    if (!frontmatter || typeof frontmatter !== "object") {
      ctx.logger.info(`[migrator rfc-0492] skip non-object frontmatter: ${filePath}`);
      continue;
    }

    const before = JSON.stringify(frontmatter);
    transformFrontmatter(frontmatter);
    const after = JSON.stringify(frontmatter);

    if (before !== after) {
      const output = "---\n" + stringifyYaml(frontmatter) + "---\n" + body;
      await io.writeFile(filePath, output);
      ctx.logger.info(`[migrator rfc-0492] transformed: ${path.relative(data.rootPath, filePath)}`);
    }
  }

  return data;
}

export const rfc0492Migrator: Migrator = {
  id: RFC_0492_MIGRATOR_ID,
  fromVersion: "4.7.0",
  toVersion: "4.8.0",
  description:
    "Copy deprecated industry fields (proofSignals, faqs, painPoints) to new dossier equivalents (trustSignals, industryFaq, evidenceRequirements)",
  transform: async (data, ctx) => {
    return transformIndustryFiles(data, ctx);
  },
};
