/*
<MODULE_CONTRACT>
<purpose>RFC-0500: snapshot test for the ratgeber topics→articles migrator —
verifies that topics are moved to articles, sections are converted to prose,
frontmatter fields are renamed, and FAQ-only entries are removed.</purpose>
<keywords>RFC-0500, migrator, snapshot, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0500: initial snapshot test for topics→articles migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0500Migrator } from "./rfc-0500.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

async function createWorkpiece(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0500-snap-"));
  const topicsDir = path.join(dir, "src", "content", "surface", "topics", "de");
  await fs.mkdir(topicsDir, { recursive: true });
  await fs.writeFile(
    path.join(topicsDir, "website-kosten.md"),
    "---\nname: Website Kosten\nslug: website-kosten\nintro: Was kostet eine Website?\nsections:\n  - heading: Überblick\n    body: Die Kosten hängen von verschiedenen Faktoren ab.\n---\n",
  );
  await fs.writeFile(
    path.join(topicsDir, "faq-only.md"),
    "---\nname: FAQ Only\nslug: faq-only\nfaqs:\n  - question: Q\n    answer: A\n---\n",
  );
  return dir;
}

test("rfc-0500 snapshot: moves topics to articles and transforms frontmatter", async () => {
  const dir = await createWorkpiece();
  try {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0500Migrator.transform(data, ctx);

    const articlesDir = path.join(dir, "src", "content", "surface", "articles");
    const topicsDir = path.join(dir, "src", "content", "surface", "topics");

    expect(
      await fs
        .stat(articlesDir)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);
    expect(
      await fs
        .stat(topicsDir)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);

    const articlePath = path.join(articlesDir, "de", "website-kosten.md");
    const content = await fs.readFile(articlePath, "utf8");
    expect(content).toContain("title: Website Kosten");
    expect(content).toContain("summary: Was kostet eine Website?");
    expect(content).toContain("status: published");
    expect(content).toContain("articleType: grundlagenartikel");
    expect(content).not.toContain("sections:");

    const faqOnlyPath = path.join(articlesDir, "de", "faq-only.md");
    expect(
      await fs
        .stat(faqOnlyPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);

    const prosePath = path.join(dir, "src", "content", "prose", "ratgeber-de-website-kosten.md");
    const proseContent = await fs.readFile(prosePath, "utf8");
    expect(proseContent).toContain("## Überblick");
    expect(proseContent).toContain("Die Kosten");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("rfc-0500 snapshot: migrator is idempotent on already-migrated content", async () => {
  const dir = await createWorkpiece();
  try {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const once = await rfc0500Migrator.transform(data, ctx);
    const articlesDir = path.join(dir, "src", "content", "surface", "articles");
    const articlePath = path.join(articlesDir, "de", "website-kosten.md");
    const content1 = await fs.readFile(articlePath, "utf8");

    const twice = await rfc0500Migrator.transform(once, ctx);
    const content2 = await fs.readFile(articlePath, "utf8");

    expect(content2).toEqual(content1);
    expect(twice).toEqual(once);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
