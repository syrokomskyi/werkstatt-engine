/*
<MODULE_CONTRACT>
<purpose>RFC-0500: PBT for the ratgeber topics→articles migrator —
verifies idempotency f(f(x))==f(x) on synthetic fixture data.</purpose>
<keywords>RFC-0500, migrator, PBT, property-based test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0500: initial PBT for topics→articles migrator.</item>
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0500-pbt-"));
  const topicsDir = path.join(dir, "src", "content", "surface", "topics", "de");
  await fs.mkdir(topicsDir, { recursive: true });
  await fs.writeFile(
    path.join(topicsDir, "website-kosten.md"),
    "---\nname: Website Kosten\nslug: website-kosten\nintro: Was kostet eine Website?\nsections:\n  - heading: Überblick\n    body: Die Kosten hängen von verschiedenen Faktoren ab.\n---\n",
  );
  return dir;
}

async function snapshotDir(dir: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  async function walk(d: string) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith(".md")) {
        snapshot.set(fullPath, await fs.readFile(fullPath, "utf8"));
      }
    }
  }
  await walk(dir);
  return snapshot;
}

test("rfc-0500 PBT: migrator is idempotent f(f(x))==f(x)", async () => {
  const dir = await createWorkpiece();
  try {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const once = await rfc0500Migrator.transform(data, ctx);
    const snap1 = await snapshotDir(dir);

    const twice = await rfc0500Migrator.transform(once, ctx);
    const snap2 = await snapshotDir(dir);

    expect(twice).toEqual(once);
    expect(snap2.size).toEqual(snap1.size);
    for (const [file, content] of snap1) {
      expect(snap2.get(file)).toEqual(content);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
