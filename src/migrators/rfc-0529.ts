/*
<MODULE_CONTRACT>
<purpose>RFC-0529: content reference brace-to-braceless migrator — transforms existing
content files by replacing brace-delimited {collection.file.field} patterns with
braceless collection.file.field syntax. Scans all .md and .yaml files under
src/content/. Idempotent: running twice produces the same result.</purpose>
<non-goals>
  <item>Do not resolve references — only syntax transformation.</item>
  <item>Do not migrate files outside src/content/.</item>
  <item>Do not modify generated files (*.generated.yaml, *.credits.yaml, *.manifest.yaml).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0529: initial migrator — convert brace-delimited content references to braceless syntax.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";

export const RFC_0529_MIGRATOR_ID = "rfc-0529";

const BRACE_REF_PATTERN = /\{([a-z][a-z-]*[./][a-z0-9-/]+\.[a-zA-Z0-9_.-]+)\}/g;

function normalizeRefSeparator(ref: string): string {
  return ref.replace(/^([a-z][a-z-]*)\//, "$1.");
}

function migrateString(value: string): string {
  if (!value.includes("{")) return value;
  let result = value;
  const pattern = new RegExp(BRACE_REF_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  const replacements: Array<{ original: string; replacement: string }> = [];

  while ((match = pattern.exec(value)) !== null) {
    const fullMatch = match[0];
    const inner = match[1];
    replacements.push({ original: fullMatch, replacement: normalizeRefSeparator(inner) });
  }

  for (const { original, replacement } of replacements) {
    result = result.replace(original, replacement);
  }

  return result;
}

function migrateYamlLine(line: string): string {
  if (!line.includes("{")) return line;

  const valueMatch = line.match(/^(\s*\S+:?\s*)(["'])(.*)\2\s*$/);
  if (!valueMatch) {
    return migrateString(line);
  }

  const prefix = valueMatch[1];
  const quote = valueMatch[2];
  const content = valueMatch[3];

  const pureRefPattern = /^[a-z][a-z-]*\.[a-z0-9-/]+\.[a-zA-Z0-9_.-]+$/;
  const migratedContent = migrateString(content);

  if (pureRefPattern.test(migratedContent)) {
    return `${prefix}${migratedContent}`;
  }

  return `${prefix}${quote}${migratedContent}${quote}`;
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2] };
}

function migrateFrontmatter(frontmatter: string): string {
  const lines = frontmatter.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    if (line.includes("{")) {
      result.push(migrateYamlLine(line));
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

function migrateMarkdownFile(content: string): string {
  const parts = splitFrontmatter(content);
  if (!parts) {
    return migrateString(content);
  }

  const migratedFm = migrateFrontmatter(parts.frontmatter);
  const migratedBody = migrateString(parts.body);

  return `---\n${migratedFm}\n---\n${migratedBody}`;
}

function migrateYamlFile(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    if (line.includes("{")) {
      result.push(migrateYamlLine(line));
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

async function scanDir(
  dir: string,
  ctx: MigrationContext,
  isGenerated: (name: string) => boolean,
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("-") || entry.name.startsWith("old-")) continue;
      await scanDir(fullPath, ctx, isGenerated);
    } else if (entry.isFile()) {
      if (isGenerated(entry.name)) continue;
      if (entry.name.endsWith(".md")) {
        await migrateMarkdownFileOnDisk(fullPath, ctx);
      } else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
        await migrateYamlFileOnDisk(fullPath, ctx);
      }
    }
  }
}

function isGeneratedFile(name: string): boolean {
  return (
    name.endsWith(".generated.yaml") ||
    name.endsWith(".generated.yml") ||
    name.endsWith(".credits.yaml") ||
    name.endsWith(".manifest.yaml")
  );
}

async function migrateMarkdownFileOnDisk(filePath: string, ctx: MigrationContext): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return;
  }

  if (!content.includes("{")) return;

  const migrated = migrateMarkdownFile(content);
  if (migrated !== content) {
    try {
      await fs.writeFile(filePath, migrated, "utf-8");
      ctx.logger.info(`[rfc-0529] migrated content references in ${filePath}`);
    } catch (err) {
      throw new MigrationError(
        RFC_0529_MIGRATOR_ID,
        filePath,
        "",
        `Failed to migrate content references: ${(err as Error).message}`,
      );
    }
  }
}

async function migrateYamlFileOnDisk(filePath: string, ctx: MigrationContext): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return;
  }

  if (!content.includes("{")) return;

  const migrated = migrateYamlFile(content);
  if (migrated !== content) {
    try {
      await fs.writeFile(filePath, migrated, "utf-8");
      ctx.logger.info(`[rfc-0529] migrated content references in ${filePath}`);
    } catch (err) {
      throw new MigrationError(
        RFC_0529_MIGRATOR_ID,
        filePath,
        "",
        `Failed to migrate content references: ${(err as Error).message}`,
      );
    }
  }
}

export const rfc0529Migrator: Migrator = {
  id: RFC_0529_MIGRATOR_ID,
  fromVersion: "4.19.0",
  toVersion: "4.20.0",
  description:
    "Convert brace-delimited {collection.file.field} content references to braceless collection.file.field syntax in all .md and .yaml files under src/content/. Idempotent. Advances migratorCursor for RFC-0529 (braceless content reference migration).",
  transform: async (data: SternsystemData, ctx: MigrationContext) => {
    const contentDir = path.join(data.rootPath, "src", "content");

    try {
      await fs.stat(contentDir);
    } catch {
      ctx.logger.info(`[rfc-0529] no content directory at ${contentDir} — skipping`);
      return data;
    }

    await scanDir(contentDir, ctx, isGeneratedFile);

    return data;
  },
};
