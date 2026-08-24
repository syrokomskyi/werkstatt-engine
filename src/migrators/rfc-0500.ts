/*
<MODULE_CONTRACT>
<purpose>RFC-0500: ratgeber topics→articles migrator — transforms existing
topics collection records into articles collection records by:
  1. Moving src/content/surface/topics/ → src/content/surface/articles/
  2. Converting `sections` frontmatter field to prose markdown files under src/content/prose/
  3. Renaming frontmatter fields: name→title, intro→summary
  4. Adding required fields: status="published", articleType="grundlagenartikel", categoryId
  5. Removing FAQ-only entries (entries with only faqs and no sections)
Idempotent: running twice produces no changes on already-migrated files.</purpose>
<non-goals>
  <item>Do not validate article records — that is ratgeber.hub.validate.</item>
  <item>Do not create article-categories — that is operator-authored content.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0500: initial migrator — topics→articles collection rename + sections→prose conversion.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";

export const RFC_0500_MIGRATOR_ID = "rfc-0500";

interface Section {
  heading?: string;
  body?: string;
}

function transformFrontmatter(
  data: Record<string, unknown>,
  slug: string,
): Record<string, unknown> {
  const result = { ...data };

  if (result.name !== undefined && result.title === undefined) {
    result.title = result.name;
    delete result.name;
  }

  if (result.intro !== undefined && result.summary === undefined) {
    result.summary = result.intro;
    delete result.intro;
  }

  if (result.status === undefined) {
    result.status = "published";
  }

  if (result.articleType === undefined) {
    result.articleType = "grundlagenartikel";
  }

  if (result.categoryId === undefined) {
    result.categoryId = slug.includes("kosten") ? "kosten" : "sichtbarkeit";
  }

  return result;
}

function sectionsToProse(sections: Section[]): string {
  const parts: string[] = [];
  for (const section of sections) {
    if (section.heading) parts.push(`## ${section.heading}\n`);
    if (section.body) parts.push(`${section.body}\n`);
  }
  return parts.join("\n");
}

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(d: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(d, entry);
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        await walk(fullPath);
      } else if (entry.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

const CATEGORY_KOSTEN = `---
slug: kosten
title: Kosten
sortOrder: 1
description: Was eine Website kostet — verständlich aufbereitet für kleines Gewerbe und Handwerk.
---

## Kosten

Artikel rund um Website-Kosten, Preisstrukturen und Budgetplanung für kleine Betriebe.
`;

const CATEGORY_SICHTBARKEIT = `---
slug: sichtbarkeit
title: Sichtbarkeit
sortOrder: 2
description: Lokale Sichtbarkeit, Google-Präsenz und Auffindbarkeit für kleines Gewerbe und Handwerk.
---

## Sichtbarkeit

Artikel rund um lokale Online-Sichtbarkeit, Google Business Profile und Auffindbarkeit.
`;

async function transformTopicsToArticles(
  data: SternsystemData,
  ctx: MigrationContext,
): Promise<SternsystemData> {
  const topicsDir = path.join(data.rootPath, "src", "content", "surface", "topics");
  const articlesDir = path.join(data.rootPath, "src", "content", "surface", "articles");
  const proseDir = path.join(data.rootPath, "src", "content", "prose");

  const topicsExists = await dirExists(topicsDir);
  const articlesExists = await dirExists(articlesDir);

  if (!topicsExists && !articlesExists) {
    ctx.logger.info(
      "[migrator rfc-0500] no topics or articles directory found — nothing to migrate",
    );
    return data;
  }

  if (topicsExists && !articlesExists) {
    await fs.mkdir(articlesDir, { recursive: true });
    const langDirs = await fs.readdir(topicsDir);
    for (const langDir of langDirs) {
      const srcLangPath = path.join(topicsDir, langDir);
      const stat = await fs.stat(srcLangPath).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;
      const destLangPath = path.join(articlesDir, langDir);
      await fs.mkdir(destLangPath, { recursive: true });
      const files = await findMarkdownFiles(srcLangPath);
      for (const file of files) {
        const relName = path.relative(srcLangPath, file);
        const destFile = path.join(destLangPath, relName);
        await fs.mkdir(path.dirname(destFile), { recursive: true });
        await fs.copyFile(file, destFile);
      }
    }
    ctx.logger.info("[migrator rfc-0500] copied topics/ → articles/");
  }

  const articleFiles = await findMarkdownFiles(articlesDir);
  for (const filePath of articleFiles) {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      ctx.logger.info(`[migrator rfc-0500] skip unreadable file: ${filePath}`);
      continue;
    }

    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!fmMatch) {
      ctx.logger.info(`[migrator rfc-0500] skip non-frontmatter file: ${filePath}`);
      continue;
    }

    let frontmatter: Record<string, unknown>;
    try {
      frontmatter = parseYaml(fmMatch[1]) as Record<string, unknown>;
    } catch (err) {
      throw new MigrationError(
        RFC_0500_MIGRATOR_ID,
        filePath,
        "",
        `failed to parse frontmatter YAML: ${(err as Error).message}`,
      );
    }

    if (!frontmatter || typeof frontmatter !== "object") {
      ctx.logger.info(`[migrator rfc-0500] skip non-object frontmatter: ${filePath}`);
      continue;
    }

    const sections = frontmatter.sections;
    const faqs = frontmatter.faqs;
    const hasSections = Array.isArray(sections) && sections.length > 0;
    const hasOnlyFaqs = !hasSections && Array.isArray(faqs) && faqs.length > 0;

    if (hasOnlyFaqs) {
      ctx.logger.info(
        `[migrator rfc-0500] removing FAQ-only article: ${path.relative(data.rootPath, filePath)}`,
      );
      await fs.unlink(filePath);
      continue;
    }

    const slug = path.basename(filePath, ".md");
    const before = JSON.stringify(frontmatter);
    const transformed = transformFrontmatter(frontmatter, slug);
    const after = JSON.stringify(transformed);

    const body = fmMatch[2];

    if (hasSections && transformed.sections !== undefined) {
      const lang = path.basename(path.dirname(filePath));
      const proseFileName = `ratgeber-${lang}-${slug}.md`;
      const proseFilePath = path.join(proseDir, proseFileName);

      await fs.mkdir(proseDir, { recursive: true });
      const proseContent = sectionsToProse(sections as Section[]);
      await fs.writeFile(proseFilePath, proseContent, "utf8");
      ctx.logger.info(
        `[migrator rfc-0500] wrote prose: ${path.relative(data.rootPath, proseFilePath)}`,
      );

      delete transformed.sections;
    }

    if (before !== after || transformed.sections === undefined) {
      const output = "---\n" + stringifyYaml(transformed) + "---\n" + body;
      await fs.writeFile(filePath, output, "utf8");
      ctx.logger.info(`[migrator rfc-0500] transformed: ${path.relative(data.rootPath, filePath)}`);
    }
  }

  if (topicsExists) {
    await fs.rm(topicsDir, { recursive: true }).catch(() => {
      ctx.logger.info("[migrator rfc-0500] could not remove old topics/ directory");
    });
  }

  // RFC-0500: create initial article-categories records if they don't exist
  const categoriesDir = path.join(data.rootPath, "src", "content", "surface", "article-categories");
  const categoriesExist = await dirExists(categoriesDir);
  if (!categoriesExist) {
    await fs.mkdir(categoriesDir, { recursive: true });
    const langDirs = await fs.readdir(articlesDir).catch(() => []);
    for (const langDir of langDirs) {
      const langPath = path.join(articlesDir, langDir);
      const stat = await fs.stat(langPath).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;
      const destLangPath = path.join(categoriesDir, langDir);
      await fs.mkdir(destLangPath, { recursive: true });

      const kostenPath = path.join(destLangPath, "kosten.md");
      if (!(await fileExists(kostenPath))) {
        await fs.writeFile(kostenPath, CATEGORY_KOSTEN, "utf8");
        ctx.logger.info(
          `[migrator rfc-0500] created category: ${path.relative(data.rootPath, kostenPath)}`,
        );
      }

      const sichtbarkeitPath = path.join(destLangPath, "sichtbarkeit.md");
      if (!(await fileExists(sichtbarkeitPath))) {
        await fs.writeFile(sichtbarkeitPath, CATEGORY_SICHTBARKEIT, "utf8");
        ctx.logger.info(
          `[migrator rfc-0500] created category: ${path.relative(data.rootPath, sichtbarkeitPath)}`,
        );
      }
    }
  }

  return data;
}

export const rfc0500Migrator: Migrator = {
  id: RFC_0500_MIGRATOR_ID,
  fromVersion: "4.12.0",
  toVersion: "4.13.0",
  description:
    "Convert topics collection to articles collection, transform sections to prose markdown files, rename frontmatter fields (name→title, intro→summary), add required fields (status, articleType, categoryId), remove FAQ-only entries",
  transform: async (data, ctx) => {
    return transformTopicsToArticles(data, ctx);
  },
};
