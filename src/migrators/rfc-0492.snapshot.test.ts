/*
<MODULE_CONTRACT>
<purpose>RFC-0492: snapshot test for the industry dossier migrator —
verifies that deprecated fields are copied to new dossier equivalents
and that the migrator is idempotent on synthetic fixture data.</purpose>
<keywords>RFC-0492, migrator, snapshot, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0492: initial snapshot test for industry dossier migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0492Migrator } from "./rfc-0492.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

async function withTempWorkpiece(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0492-snap-"));
  const industriesDir = path.join(dir, "src", "content", "surface", "industries", "de");
  await fs.mkdir(industriesDir, { recursive: true });
  await fs.writeFile(
    path.join(industriesDir, "elektriker.md"),
    "---\nname: Elektriker\nslug: elektriker\nproofSignals:\n  - signal1\nfaqs:\n  - question: Q\n    answer: A\npainPoints:\n  - pain1\n---\n",
  );
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("rfc-0492 snapshot: copies deprecated fields to new dossier equivalents", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0492Migrator.transform(data, ctx);

    const filePath = path.join(
      dir,
      "src",
      "content",
      "surface",
      "industries",
      "de",
      "elektriker.md",
    );
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toContain("trustSignals");
    expect(content).toContain("industryFaq");
    expect(content).toContain("evidenceRequirements");
  });
});

test("rfc-0492 snapshot: migrator is idempotent on already-migrated content", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const once = await rfc0492Migrator.transform(data, ctx);
    const filePath = path.join(
      dir,
      "src",
      "content",
      "surface",
      "industries",
      "de",
      "elektriker.md",
    );
    const content1 = await fs.readFile(filePath, "utf8");

    const twice = await rfc0492Migrator.transform(once, ctx);
    const content2 = await fs.readFile(filePath, "utf8");

    expect(content2).toEqual(content1);
    expect(twice).toEqual(once);
  });
});
