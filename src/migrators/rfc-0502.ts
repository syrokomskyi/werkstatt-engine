/*
<MODULE_CONTRACT>
<purpose>RFC-0502: ratgeber editorial provenance migrator — creates the initial
author record file surface/authors/{lang}/andrii-syrokomskyi.md if it does not
already exist. Idempotent: if the file exists, the migrator is a no-op.
Advances the migratorCursor for RFC-0502 (authors, sources, claims, review metadata).</purpose>
<non-goals>
  <item>Do not create claim sidecars — those are human-authored provenance artifacts.</item>
  <item>Do not modify article records — RFC-0500's migrator already set authorId.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0502: initial migrator — creates initial author record file.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";

export const RFC_0502_MIGRATOR_ID = "rfc-0502";

const AUTHOR_RECORD_DE = `---
id: andrii-syrokomskyi
name: "Andrii Syrokomskyi"
role: "Redakteur"
bio: "Betreut den Ratgeber seit 2026. Hintergrund in Webentwicklung und digitalem Fundament für kleines Gewerbe."
contactUrl: "https://warpgogol.com/kontakt"
---
`;

const AUTHOR_RECORD_UK = `---
id: andrii-syrokomskyi
name: "Andrii Syrokomskyi"
role: "Редактор"
bio: "Відповідає за довідник з 2026 року. Досвід у веброзробці та цифровому фундаменті для малого бізнесу."
contactUrl: "https://warpgogol.com/kontakt"
---
`;

const AUTHOR_RECORDS: Record<string, string> = {
  de: AUTHOR_RECORD_DE,
  uk: AUTHOR_RECORD_UK,
};

export const rfc0502Migrator: Migrator = {
  id: RFC_0502_MIGRATOR_ID,
  fromVersion: "4.13.0",
  toVersion: "4.14.0",
  description:
    "Create initial author record file surface/authors/{lang}/andrii-syrokomskyi.md if it does not exist. Advances migratorCursor for RFC-0502 (ratgeber editorial provenance — authors, sources, claims, and review metadata).",
  transform: async (data: SternsystemData, ctx: MigrationContext) => {
    const authorsBaseDir = path.join(data.rootPath, "src", "content", "surface", "authors");

    let langDirs: string[];
    try {
      langDirs = await fs.readdir(authorsBaseDir);
    } catch {
      ctx.logger.info(`[rfc-0502] no authors directory at ${authorsBaseDir} — creating`);
      await fs.mkdir(authorsBaseDir, { recursive: true });
      langDirs = [];
    }

    const langsToProcess = langDirs.length > 0 ? langDirs : ["de", "uk"];

    for (const lang of langsToProcess) {
      const langPath = path.join(authorsBaseDir, lang);
      const stat = await fs.stat(langPath).catch(() => null);
      if (!stat?.isDirectory()) {
        await fs.mkdir(langPath, { recursive: true });
      }

      const authorFile = path.join(langPath, "andrii-syrokomskyi.md");
      const exists = await fs
        .stat(authorFile)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        ctx.logger.info(`[rfc-0502] author record already exists: ${lang}/andrii-syrokomskyi.md`);
        continue;
      }

      const content = AUTHOR_RECORDS[lang] ?? AUTHOR_RECORD_DE!;
      try {
        await fs.writeFile(authorFile, content, "utf-8");
        ctx.logger.info(`[rfc-0502] created author record: ${lang}/andrii-syrokomskyi.md`);
      } catch (err) {
        throw new MigrationError(
          RFC_0502_MIGRATOR_ID,
          authorFile,
          "",
          `Failed to create author record: ${(err as Error).message}`,
        );
      }
    }

    return data;
  },
};
