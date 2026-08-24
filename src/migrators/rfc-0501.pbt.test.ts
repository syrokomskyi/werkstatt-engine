/*
<MODULE_CONTRACT>
  <purpose>RFC-0501: PBT test for the article status review migrator — verifies
  idempotency (f(f(x)) == f(x)) over arbitrary SternsystemData with article files.</purpose>
  <keywords>RFC-0501, migrator, pbt, idempotency, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0501: initial PBT test for article status review migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
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

test("rfc-0501 migrator is idempotent: f(f(x)) == f(x) for arbitrary data", async () => {
  const dataArbitrary = fc.record({
    rootPath: fc.string({ minLength: 1, maxLength: 100 }),
    dataPaths: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 10 }),
  });

  await fc.asyncProperty(dataArbitrary, async (data) => {
    const once = await rfc0501Migrator.transform(data as SternsystemData, ctx);
    const twice = await rfc0501Migrator.transform(once, ctx);
    expect(twice).toEqual(once);
  });
});

test("rfc-0501 migrator: sets published articles to review-required", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0501-pbt-"));
  try {
    const articlesDir = path.join(dir, "src", "content", "surface", "articles", "de");
    await fs.mkdir(articlesDir, { recursive: true });
    await fs.writeFile(
      path.join(articlesDir, "test-article.md"),
      "---\ntitle: Test Article\nstatus: published\narticleType: grundlagenartikel\n---\n\nContent here.\n",
    );

    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0501Migrator.transform(data, ctx);

    const raw = await fs.readFile(path.join(articlesDir, "test-article.md"), "utf8");
    expect(raw).toContain("status: review-required");
    expect(raw).not.toContain("status: published");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("rfc-0501 migrator: does not modify non-published articles", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0501-pbt-"));
  try {
    const articlesDir = path.join(dir, "src", "content", "surface", "articles", "de");
    await fs.mkdir(articlesDir, { recursive: true });
    await fs.writeFile(
      path.join(articlesDir, "draft-article.md"),
      "---\ntitle: Draft Article\nstatus: draft\narticleType: grundlagenartikel\n---\n\nContent here.\n",
    );

    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0501Migrator.transform(data, ctx);

    const raw = await fs.readFile(path.join(articlesDir, "draft-article.md"), "utf8");
    expect(raw).toContain("status: draft");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
