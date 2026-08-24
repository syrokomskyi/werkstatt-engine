/*
<MODULE_CONTRACT>
<purpose>RFC-0501: ratgeber article status review migrator — sets existing published
ratgeber articles to status: review-required so they don't fail the publication gate
until their prose bodies are updated with the mandatory 10-section structure.
Idempotent: running twice produces no changes on already-migrated files.</purpose>
<non-goals>
  <item>Do not validate article records — that is ratgeber.article.validate.</item>
  <item>Do not modify prose files — only article frontmatter status field.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0501: initial migrator — set existing published ratgeber articles to review-required.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";

export const RFC_0501_MIGRATOR_ID = "rfc-0501";

export const rfc0501Migrator: Migrator = {
  id: RFC_0501_MIGRATOR_ID,
  fromVersion: "4.12.0",
  toVersion: "4.13.0",
  description:
    "Set existing published ratgeber articles to review-required — their prose bodies don't have the 10-section structure yet. Advances migratorCursor for RFC-0501 (ratgeber article types, mandatory structure, and publication gate).",
  transform: async (data: SternsystemData, ctx: MigrationContext) => {
    const articlesBaseDir = path.join(data.rootPath, "src", "content", "surface", "articles");

    let langDirs: string[];
    try {
      langDirs = await fs.readdir(articlesBaseDir);
    } catch {
      ctx.logger.info(`[rfc-0501] no articles directory at ${articlesBaseDir} — skipping`);
      return data;
    }

    for (const langDir of langDirs) {
      const langPath = path.join(articlesBaseDir, langDir);
      const stat = await fs.stat(langPath).catch(() => null);
      if (!stat?.isDirectory()) continue;

      let files: string[];
      try {
        files = await fs.readdir(langPath);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const filePath = path.join(langPath, file);
        const raw = await fs.readFile(filePath, "utf-8");

        const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(raw);
        if (!frontmatterMatch) continue;

        const fmYaml = frontmatterMatch[1]!;
        const fmData = parseYaml(fmYaml) as Record<string, unknown> | null;
        if (!fmData) continue;

        if (fmData.status !== "published") continue;

        fmData.status = "review-required";
        const updatedFmYaml = stringifyYaml(fmData).trim();
        const updatedRaw = `---\n${updatedFmYaml}\n---${raw.slice(frontmatterMatch[0].length)}`;

        try {
          await fs.writeFile(filePath, updatedRaw, "utf-8");
          ctx.logger.info(`[rfc-0501] set ${file} to review-required`);
        } catch (err) {
          throw new MigrationError(
            RFC_0501_MIGRATOR_ID,
            filePath,
            "status",
            `Failed to write updated frontmatter: ${(err as Error).message}`,
          );
        }
      }
    }

    return data;
  },
};
