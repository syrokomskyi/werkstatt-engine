/*
<MODULE_CONTRACT>
  <purpose>RFC-0501: snapshot test for the article status review migrator — verifies
  that applying the migrator to a representative workpiece sets published articles to
  review-required while leaving draft articles unchanged.</purpose>
  <keywords>RFC-0501, migrator, snapshot, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0501: initial snapshot test for article status review migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0501Migrator } from "./rfc-0501.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

async function withTempWorkpiece(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0501-snap-"));
  const articlesDir = path.join(dir, "src", "content", "surface", "articles", "de");
  await fs.mkdir(articlesDir, { recursive: true });
  await fs.writeFile(
    path.join(articlesDir, "published-article.md"),
    "---\ntitle: Published Article\nstatus: published\narticleType: grundlagenartikel\ncategoryId: grundlagen\n---\n\nContent here.\n",
  );
  await fs.writeFile(
    path.join(articlesDir, "draft-article.md"),
    "---\ntitle: Draft Article\nstatus: draft\narticleType: grundlagenartikel\ncategoryId: grundlagen\n---\n\nContent here.\n",
  );
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("rfc-0501 snapshot: published article is set to review-required", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const filePath = path.join(
      dir,
      "src",
      "content",
      "surface",
      "articles",
      "de",
      "published-article.md",
    );

    await rfc0501Migrator.transform(data, ctx);

    const after = await fs.readFile(filePath, "utf8");
    expect(after).toContain("status: review-required");
    expect(after).not.toContain("status: published");
  });
});

test("rfc-0501 snapshot: draft article is left unchanged", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const filePath = path.join(
      dir,
      "src",
      "content",
      "surface",
      "articles",
      "de",
      "draft-article.md",
    );
    const before = await fs.readFile(filePath, "utf8");

    await rfc0501Migrator.transform(data, ctx);

    const after = await fs.readFile(filePath, "utf8");
    expect(after).toEqual(before);
  });
});

test("rfc-0501 snapshot: migrator is idempotent on real content", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const filePath = path.join(
      dir,
      "src",
      "content",
      "surface",
      "articles",
      "de",
      "published-article.md",
    );

    const once = await rfc0501Migrator.transform(data, ctx);
    const content1 = await fs.readFile(filePath, "utf8");
    const twice = await rfc0501Migrator.transform(once, ctx);
    const content2 = await fs.readFile(filePath, "utf8");

    expect(content2).toEqual(content1);
    expect(twice).toEqual(once);
  });
});
