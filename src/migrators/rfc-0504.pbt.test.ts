/*
<MODULE_CONTRACT>
<purpose>RFC-0504: PBT test for the rfc-0504 migrator — verifies idempotency
(f(f(x)) == f(x)) by running the migrator twice and checking the result is
identical.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0504: initial PBT test for rfc-0504 migrator idempotency.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0504Migrator } from "./rfc-0504.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

function makeCtx(): MigrationContext {
  return {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };
}

function makeData(tmpDir: string): SternsystemData {
  return {
    rootPath: tmpDir,
    dataPaths: [],
  };
}

const SAMPLE_ARTICLE = `---
title: "Test Article"
articleType: grundlagenartikel
status: published
categoryId: test
---

Content here.
`;

const SAMPLE_PROSE_WITH_H1 = `# Test Article

## Einleitung

Some content.

## Kernfrage

A question.
`;

const SAMPLE_PROSE_WITH_UNIQUE_H1 = `# Unique Heading

## Einleitung

Some content.
`;

test("rfc-0504 migrator is idempotent — f(f(x)) == f(x)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0504-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    // Set up article + prose files
    const articleDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
    const proseDir = path.join(tmpDir, "src", "content", "prose", "de");
    await fs.mkdir(articleDir, { recursive: true });
    await fs.mkdir(proseDir, { recursive: true });
    await fs.writeFile(path.join(articleDir, "test-article.md"), SAMPLE_ARTICLE, "utf-8");
    await fs.writeFile(
      path.join(proseDir, "ratgeber-test-article.md"),
      SAMPLE_PROSE_WITH_H1,
      "utf-8",
    );

    // First run
    await rfc0504Migrator.transform(data, ctx);
    const articleAfter1 = await fs.readFile(path.join(articleDir, "test-article.md"), "utf-8");
    const proseAfter1 = await fs.readFile(path.join(proseDir, "ratgeber-test-article.md"), "utf-8");

    // Second run
    await rfc0504Migrator.transform(data, ctx);
    const articleAfter2 = await fs.readFile(path.join(articleDir, "test-article.md"), "utf-8");
    const proseAfter2 = await fs.readFile(path.join(proseDir, "ratgeber-test-article.md"), "utf-8");

    expect(articleAfter1).toBe(articleAfter2);
    expect(proseAfter1).toBe(proseAfter2);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0504 migrator adds articleSections and changelog fields", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0504-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    const articleDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
    await fs.mkdir(articleDir, { recursive: true });
    await fs.writeFile(path.join(articleDir, "test-article.md"), SAMPLE_ARTICLE, "utf-8");

    await rfc0504Migrator.transform(data, ctx);

    const content = await fs.readFile(path.join(articleDir, "test-article.md"), "utf-8");
    expect(content).toMatch(/articleSections:\s*\[\]/);
    expect(content).toMatch(/changelog:\s*\[\]/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0504 migrator strips H1 that duplicates article title", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0504-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    const articleDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
    const proseDir = path.join(tmpDir, "src", "content", "prose", "de");
    await fs.mkdir(articleDir, { recursive: true });
    await fs.mkdir(proseDir, { recursive: true });
    await fs.writeFile(path.join(articleDir, "test-article.md"), SAMPLE_ARTICLE, "utf-8");
    await fs.writeFile(
      path.join(proseDir, "ratgeber-test-article.md"),
      SAMPLE_PROSE_WITH_H1,
      "utf-8",
    );

    await rfc0504Migrator.transform(data, ctx);

    const prose = await fs.readFile(path.join(proseDir, "ratgeber-test-article.md"), "utf-8");
    expect(prose).not.toMatch(/^#\s+Test Article/m);
    expect(prose).toMatch(/^## Einleitung/m);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0504 migrator converts unique H1 to H2", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0504-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    const articleDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
    const proseDir = path.join(tmpDir, "src", "content", "prose", "de");
    await fs.mkdir(articleDir, { recursive: true });
    await fs.mkdir(proseDir, { recursive: true });
    await fs.writeFile(path.join(articleDir, "test-article.md"), SAMPLE_ARTICLE, "utf-8");
    await fs.writeFile(
      path.join(proseDir, "ratgeber-test-article.md"),
      SAMPLE_PROSE_WITH_UNIQUE_H1,
      "utf-8",
    );

    await rfc0504Migrator.transform(data, ctx);

    const prose = await fs.readFile(path.join(proseDir, "ratgeber-test-article.md"), "utf-8");
    expect(prose).not.toMatch(/^#\s+Unique Heading/m);
    expect(prose).toMatch(/^## Unique Heading/m);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0504 migrator removes H1 when duplicate H2 exists", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0504-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    const articleDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
    const proseDir = path.join(tmpDir, "src", "content", "prose", "de");
    await fs.mkdir(articleDir, { recursive: true });
    await fs.mkdir(proseDir, { recursive: true });
    await fs.writeFile(path.join(articleDir, "test-article.md"), SAMPLE_ARTICLE, "utf-8");
    const proseWithDupH2 = `# Einleitung

## Einleitung

Content.
`;
    await fs.writeFile(path.join(proseDir, "ratgeber-test-article.md"), proseWithDupH2, "utf-8");

    await rfc0504Migrator.transform(data, ctx);

    const prose = await fs.readFile(path.join(proseDir, "ratgeber-test-article.md"), "utf-8");
    // H1 should be removed (not converted to H2) because H2 with same text exists
    const h1Matches = prose.match(/^#\s+Einleitung/gm);
    expect(h1Matches).toBeNull();
    const h2Matches = prose.match(/^##\s+Einleitung/gm);
    expect(h2Matches).toHaveLength(1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0504 migrator does not touch H1 inside fenced code blocks", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0504-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    const articleDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
    const proseDir = path.join(tmpDir, "src", "content", "prose", "de");
    await fs.mkdir(articleDir, { recursive: true });
    await fs.mkdir(proseDir, { recursive: true });
    await fs.writeFile(path.join(articleDir, "test-article.md"), SAMPLE_ARTICLE, "utf-8");
    const proseWithCodeBlock = `\`\`\`markdown
# Not a real heading
\`\`\`

## Einleitung

Content.
`;
    await fs.writeFile(
      path.join(proseDir, "ratgeber-test-article.md"),
      proseWithCodeBlock,
      "utf-8",
    );

    await rfc0504Migrator.transform(data, ctx);

    const prose = await fs.readFile(path.join(proseDir, "ratgeber-test-article.md"), "utf-8");
    expect(prose).toContain("# Not a real heading");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
