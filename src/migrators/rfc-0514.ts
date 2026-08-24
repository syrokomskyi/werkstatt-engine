/*
<MODULE_CONTRACT>
<purpose>RFC-0514: contact form structured fields migrator — transforms existing
send-message page blocks in pages/<lang>/*.md by adding emailField with enabled: true
and removing the deprecated contactRequirementMessage prop. Idempotent: running twice
produces the same result.</purpose>
<non-goals>
  <item>Do not add phoneField — it is optional and site-specific.</item>
  <item>Do not modify the section manifest or generated types — those are platform files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0514: initial migrator — add emailField to send-message blocks, remove contactRequirementMessage.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";

export const RFC_0514_MIGRATOR_ID = "rfc-0514";

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

    if (!/emailField:/m.test(newBody)) {
      const propsMatch = /^(\s*)props:\n/.exec(newBody);
      if (propsMatch) {
        const indent = propsMatch[1]!;
        newBody = newBody.replace(
          /^(\s*)props:\n/,
          `${indent}props:\n${indent}  emailField:\n${indent}    enabled: true\n${indent}    required: true\n`,
        );
      } else {
        newBody =
          `  props:\n    emailField:\n      enabled: true\n      required: true\n` + newBody;
      }
      modified = true;
    }

    newBody = newBody.replace(/\n\s*contactRequirementMessage:\s*[^\n]+/g, "");
    if (newBody !== blockBody) {
      modified = true;
    }

    return prefix + newBody;
  });

  if (modified) {
    try {
      await fs.writeFile(filePath, updated, "utf-8");
      ctx.logger.info(`[rfc-0514] migrated send-message block in ${filePath}`);
    } catch (err) {
      throw new MigrationError(
        RFC_0514_MIGRATOR_ID,
        filePath,
        "",
        `Failed to update send-message block: ${(err as Error).message}`,
      );
    }
  }
}

export const rfc0514Migrator: Migrator = {
  id: RFC_0514_MIGRATOR_ID,
  fromVersion: "4.18.0",
  toVersion: "4.19.0",
  description:
    "Add emailField with enabled: true to send-message page blocks and remove deprecated contactRequirementMessage. Advances migratorCursor for RFC-0514 (contact form structured fields).",
  transform: async (data: SternsystemData, ctx: MigrationContext) => {
    const pagesBaseDir = path.join(data.rootPath, "src", "content", "pages");

    let langDirs: string[];
    try {
      langDirs = await fs.readdir(pagesBaseDir);
    } catch {
      ctx.logger.info(`[rfc-0514] no pages directory at ${pagesBaseDir} — skipping`);
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
