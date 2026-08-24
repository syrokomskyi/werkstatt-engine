/*
<MODULE_CONTRACT>
<purpose>RFC-0572: revert contact form to single-textarea migrator — transforms existing
send-message page blocks in pages/<lang>/*.md by removing emailField and phoneField props
and re-adding contactRequirementMessage if not present. Idempotent: running twice
produces the same result. No-op on blocks that never had structured fields.</purpose>
<non-goals>
  <item>Do not modify the section manifest or generated types — those are platform files.</item>
  <item>Do not remove the referrerField — it is preserved by RFC-0572.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0572: initial migrator — remove emailField/phoneField from send-message blocks, re-add contactRequirementMessage.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";

export const RFC_0572_MIGRATOR_ID = "rfc-0572";

async function scanDir(dir: string, lang: string, ctx: MigrationContext): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDir(fullPath, lang, ctx);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      await migrateFile(fullPath, lang, ctx);
    }
  }
}

async function migrateFile(filePath: string, lang: string, ctx: MigrationContext): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return;
  }

  if (!content.includes("send-message")) return;

  let modified = false;
  let updated = content;

  const blockRegex =
    /(- id:\s*send-message(?:-section)?\n)([\s\S]*?)(?=\n- id:|\n---|\nsections:|\Z)/g;

  updated = updated.replace(blockRegex, (_match, prefix: string, blockBody: string) => {
    let newBody = blockBody;

    const emailFieldMatch = /\n(\s*)emailField:\n[\s\S]*?(?=\n\s*\S|\n\s*-\s|\Z)/g;
    const phoneFieldMatch = /\n(\s*)phoneField:\n[\s\S]*?(?=\n\s*\S|\n\s*-\s|\Z)/g;

    if (emailFieldMatch.test(newBody)) {
      newBody = newBody.replace(/\n\s*emailField:\n(\s+)[^\n]*\n/g, "");
      newBody = newBody.replace(
        /\n\s*emailField:\n\s+enabled:[^\n]*\n\s+required:[^\n]*\n(\s+(?:label|placeholder):[^\n]*\n)*/g,
        "",
      );
      modified = true;
    }

    if (phoneFieldMatch.test(newBody)) {
      newBody = newBody.replace(
        /\n\s*phoneField:\n\s+enabled:[^\n]*\n\s+required:[^\n]*\n(\s+(?:label|placeholder):[^\n]*\n)*/g,
        "",
      );
      modified = true;
    }

    if (!/contactRequirementMessage:/m.test(newBody)) {
      const propsMatch = /^(\s*)props:\n/.exec(newBody);
      if (propsMatch) {
        const indent = propsMatch[1]!;
        newBody = newBody.replace(
          /^(\s*)props:\n/,
          `${indent}props:\n${indent}  contactRequirementMessage: "Bitte hinterlassen Sie Ihre E-Mail-Adresse oder Telefonnummer im Text."\n`,
        );
        modified = true;
      }
    }

    return prefix + newBody;
  });

  if (modified) {
    try {
      await fs.writeFile(filePath, updated, "utf-8");
      ctx.logger.info(`[rfc-0572] migrated send-message block in ${filePath}`);
    } catch (err) {
      throw new MigrationError(
        RFC_0572_MIGRATOR_ID,
        filePath,
        "",
        `Failed to update send-message block: ${(err as Error).message}`,
      );
    }
  }
}

export const rfc0572Migrator: Migrator = {
  id: RFC_0572_MIGRATOR_ID,
  fromVersion: "4.19.0",
  toVersion: "4.20.0",
  description:
    "Remove emailField/phoneField from send-message page blocks and re-add contactRequirementMessage. Advances migratorCursor for RFC-0572 (revert to single-textarea contact form).",
  transform: async (data: SternsystemData, ctx: MigrationContext) => {
    const pagesBaseDir = path.join(data.rootPath, "src", "content", "pages");

    let langDirs: string[];
    try {
      langDirs = await fs.readdir(pagesBaseDir);
    } catch {
      ctx.logger.info(`[rfc-0572] no pages directory at ${pagesBaseDir} — skipping`);
      langDirs = [];
    }

    for (const lang of langDirs) {
      const langPath = path.join(pagesBaseDir, lang);
      const stat = await fs.stat(langPath).catch(() => null);
      if (!stat?.isDirectory()) continue;
      await scanDir(langPath, lang, ctx);
    }

    return data;
  },
};
