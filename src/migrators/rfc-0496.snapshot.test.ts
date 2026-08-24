/*
<MODULE_CONTRACT>
  <purpose>RFC-0496: snapshot test for the no-op migrator — verifies that
  applying the migrator to a representative workpiece leaves all files unchanged.</purpose>
  <keywords>RFC-0496, migrator, snapshot, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0496: initial snapshot test for no-op migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0496Migrator } from "./rfc-0496.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

async function withTempWorkpiece(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0496-snap-"));
  const contentDir = path.join(dir, "src", "content", "surface", "services", "de");
  await fs.mkdir(contentDir, { recursive: true });
  await fs.writeFile(
    path.join(contentDir, "website-erstellung.md"),
    "---\nname: Website-Erstellung\nslug: website-erstellung\nindustryId: elektriker\n---\n",
  );
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("rfc-0496 snapshot: no-op migrator leaves all files unchanged", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const filePath = path.join(
      dir,
      "src",
      "content",
      "surface",
      "services",
      "de",
      "website-erstellung.md",
    );
    const before = await fs.readFile(filePath, "utf8");

    await rfc0496Migrator.transform(data, ctx);

    const after = await fs.readFile(filePath, "utf8");
    expect(after).toEqual(before);
  });
});

test("rfc-0496 snapshot: no-op migrator is idempotent on real content", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const filePath = path.join(
      dir,
      "src",
      "content",
      "surface",
      "services",
      "de",
      "website-erstellung.md",
    );

    const once = await rfc0496Migrator.transform(data, ctx);
    const content1 = await fs.readFile(filePath, "utf8");
    const twice = await rfc0496Migrator.transform(once, ctx);
    const content2 = await fs.readFile(filePath, "utf8");

    expect(content2).toEqual(content1);
    expect(twice).toEqual(once);
  });
});
