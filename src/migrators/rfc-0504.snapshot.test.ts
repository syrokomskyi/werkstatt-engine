/*
<MODULE_CONTRACT>
<purpose>RFC-0504: snapshot test for the rfc-0504 migrator — verifies the
article frontmatter and prose body content match expected snapshots after
migration on a clean run.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0504: initial snapshot test for rfc-0504 migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0504Migrator } from "./rfc-0504.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const SAMPLE_ARTICLE = `---
title: "Website Kosten"
articleType: grundlagenartikel
status: published
categoryId: webentwicklung
---

Content here.
`;

const SAMPLE_PROSE = `# Website Kosten

## Einleitung

Einleitungstext.

## Kernfrage

Was kostet eine Website?

## Wissensbasis

Grundlagen.
`;

test("rfc-0504 migrator snapshot — article frontmatter after migration", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0504-snap-"));
  const data: SternsystemData = { rootPath: tmpDir, dataPaths: [] };
  const ctx: MigrationContext = {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };

  try {
    const articleDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
    await fs.mkdir(articleDir, { recursive: true });
    await fs.writeFile(path.join(articleDir, "website-kosten.md"), SAMPLE_ARTICLE, "utf-8");

    await rfc0504Migrator.transform(data, ctx);
    const content = await fs.readFile(path.join(articleDir, "website-kosten.md"), "utf-8");
    expect(content).toMatchInlineSnapshot(`
      "---
      title: "Website Kosten"
      articleType: grundlagenartikel
      status: published
      categoryId: webentwicklung
      articleSections: []
      changelog: []
      ---

      Content here.
      "
    `);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0504 migrator snapshot — prose body after H1 stripping", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0504-snap-"));
  const data: SternsystemData = { rootPath: tmpDir, dataPaths: [] };
  const ctx: MigrationContext = {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };

  try {
    const articleDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
    const proseDir = path.join(tmpDir, "src", "content", "prose", "de");
    await fs.mkdir(articleDir, { recursive: true });
    await fs.mkdir(proseDir, { recursive: true });
    await fs.writeFile(path.join(articleDir, "website-kosten.md"), SAMPLE_ARTICLE, "utf-8");
    await fs.writeFile(path.join(proseDir, "ratgeber-website-kosten.md"), SAMPLE_PROSE, "utf-8");

    await rfc0504Migrator.transform(data, ctx);
    const content = await fs.readFile(path.join(proseDir, "ratgeber-website-kosten.md"), "utf-8");
    expect(content).toMatchInlineSnapshot(`
      "
      ## Einleitung

      Einleitungstext.

      ## Kernfrage

      Was kostet eine Website?

      ## Wissensbasis

      Grundlagen.
      "
    `);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
