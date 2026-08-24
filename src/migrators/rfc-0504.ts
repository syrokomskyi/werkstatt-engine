/*
<MODULE_CONTRACT>
<purpose>RFC-0504: ratgeber article 12-section layout migrator — transforms existing
article records by adding empty `articleSections: []` and `changelog: []` frontmatter
fields if absent, and stripping H1 headings from prose bodies. H1 headings that duplicate
the article title are removed; unique H1 headings are converted to H2, unless an H2 with
the same text already exists (in which case the H1 is removed to avoid duplicate headings).
Idempotent: running twice produces the same result.</purpose>
<non-goals>
  <item>Do not auto-generate article prose bodies — new prose authoring is human editorial work.</item>
  <item>Do not add secondaryCta — it is an optional field that editors set manually.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0504: initial migrator — add empty articleSections/changelog fields, strip H1 headings from prose bodies.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { MigrationError } from "./types.ts";

export const RFC_0504_MIGRATOR_ID = "rfc-0504";

function stripH1FromMarkdown(markdown: string, articleTitle: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let inFencedCode = false;
  let inHtmlComment = false;
  const existingH2Texts = new Set<string>();

  // First pass: collect existing H2 heading texts
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      continue;
    }
    const h2Match = /^##\s+(.+)$/.exec(trimmed);
    if (h2Match) {
      existingH2Texts.add(h2Match[1]!.trim());
    }
  }

  // Second pass: process H1 headings
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFencedCode = !inFencedCode;
      result.push(line);
      continue;
    }
    if (trimmed.startsWith("<!--")) {
      inHtmlComment = true;
    }
    if (trimmed.includes("-->")) {
      inHtmlComment = false;
      result.push(line);
      continue;
    }
    if (inFencedCode || inHtmlComment) {
      result.push(line);
      continue;
    }
    const h1Match = /^#\s+(.+)$/.exec(trimmed);
    if (h1Match) {
      const h1Text = h1Match[1]!.trim();
      // If H1 duplicates the article title, remove it
      if (h1Text === articleTitle) {
        continue;
      }
      // If an H2 with the same text already exists, remove the H1 to avoid duplicates
      if (existingH2Texts.has(h1Text)) {
        continue;
      }
      // Convert unique H1 to H2
      result.push(`## ${h1Text}`);
      continue;
    }
    result.push(line);
  }

  return result.join("\n");
}

function addFieldToFrontmatter(content: string, fieldName: string, fieldValue: string): string {
  // Check if the field already exists in frontmatter
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!frontmatterMatch) return content;
  const frontmatter = frontmatterMatch[1]!;
  if (new RegExp(`^${fieldName}:`, "m").test(frontmatter)) {
    return content;
  }
  // Add the field before the closing ---
  const insertion = `${fieldName}: ${fieldValue}\n`;
  return content.replace(/^---\n([\s\S]*?)\n---/, `---\n$1\n${insertion}---`);
}

export const rfc0504Migrator: Migrator = {
  id: RFC_0504_MIGRATOR_ID,
  fromVersion: "4.14.0",
  toVersion: "4.15.0",
  description:
    "Add empty articleSections and changelog frontmatter fields to article records if absent. Strip H1 headings from prose bodies (remove duplicates of article title, convert unique H1 to H2 unless duplicate H2 exists). Advances migratorCursor for RFC-0504 (12-section ratgeber article layout).",
  transform: async (data: SternsystemData, ctx: MigrationContext) => {
    const articlesBaseDir = path.join(data.rootPath, "src", "content", "surface", "articles");
    const proseBaseDir = path.join(data.rootPath, "src", "content", "prose");

    // Process article records
    let langDirs: string[];
    try {
      langDirs = await fs.readdir(articlesBaseDir);
    } catch {
      ctx.logger.info(`[rfc-0504] no articles directory at ${articlesBaseDir} — skipping`);
      langDirs = [];
    }

    for (const lang of langDirs) {
      const langPath = path.join(articlesBaseDir, lang);
      const stat = await fs.stat(langPath).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const articleFiles = (await fs.readdir(langPath)).filter((f) => f.endsWith(".md"));
      for (const articleFile of articleFiles) {
        const articlePath = path.join(langPath, articleFile);
        let content: string;
        try {
          content = await fs.readFile(articlePath, "utf-8");
        } catch {
          continue;
        }

        // Extract article title from frontmatter
        const titleMatch = /^title:\s*"?([^"\n]+)"?/m.exec(content);
        const articleTitle = titleMatch ? titleMatch[1]!.trim() : "";

        let modified = false;
        let updated = content;

        // Add articleSections: [] if absent
        if (!/^articleSections:/m.test(content)) {
          updated = addFieldToFrontmatter(updated, "articleSections", "[]");
          modified = true;
        }

        // Add changelog: [] if absent
        if (!/^changelog:/m.test(updated)) {
          updated = addFieldToFrontmatter(updated, "changelog", "[]");
          modified = true;
        }

        if (modified) {
          try {
            await fs.writeFile(articlePath, updated, "utf-8");
            ctx.logger.info(`[rfc-0504] updated article frontmatter: ${lang}/${articleFile}`);
          } catch (err) {
            throw new MigrationError(
              RFC_0504_MIGRATOR_ID,
              articlePath,
              "",
              `Failed to update article frontmatter: ${(err as Error).message}`,
            );
          }
        }

        // Strip H1 from prose body
        const slug = articleFile.replace(/\.md$/, "");
        const proseFileName = `ratgeber-${slug}.md`;
        const prosePath = path.join(proseBaseDir, lang, proseFileName);
        const proseExists = await fs
          .stat(prosePath)
          .then(() => true)
          .catch(() => false);

        if (proseExists) {
          let proseContent: string;
          try {
            proseContent = await fs.readFile(prosePath, "utf-8");
          } catch {
            continue;
          }

          const stripped = stripH1FromMarkdown(proseContent, articleTitle);
          if (stripped !== proseContent) {
            try {
              await fs.writeFile(prosePath, stripped, "utf-8");
              ctx.logger.info(`[rfc-0504] stripped H1 from prose: ${lang}/${proseFileName}`);
            } catch (err) {
              throw new MigrationError(
                RFC_0504_MIGRATOR_ID,
                prosePath,
                "",
                `Failed to strip H1 from prose: ${(err as Error).message}`,
              );
            }
          }
        }
      }
    }

    return data;
  },
};
