/*
<MODULE_CONTRACT>
<purpose>RFC-0502: snapshot test for the rfc-0502 migrator — verifies the
author record file content matches the expected snapshot on a clean run.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0502: initial snapshot test for rfc-0502 migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0502Migrator } from "./rfc-0502.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

test("rfc-0502 migrator snapshot — de author record", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0502-snap-"));
  const data: SternsystemData = { rootPath: tmpDir, dataPaths: [] };
  const ctx: MigrationContext = {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };

  try {
    await rfc0502Migrator.transform(data, ctx);
    const deFile = path.join(
      tmpDir,
      "src",
      "content",
      "surface",
      "authors",
      "de",
      "andrii-syrokomskyi.md",
    );
    const content = await fs.readFile(deFile, "utf-8");
    expect(content).toMatchInlineSnapshot(`
      "---
      id: andrii-syrokomskyi
      name: "Andrii Syrokomskyi"
      role: "Redakteur"
      bio: "Betreut den Ratgeber seit 2026. Hintergrund in Webentwicklung und digitalem Fundament für kleines Gewerbe."
      contactUrl: "https://warpgogol.com/kontakt"
      ---
      "
    `);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0502 migrator snapshot — uk author record", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0502-snap-"));
  const data: SternsystemData = { rootPath: tmpDir, dataPaths: [] };
  const ctx: MigrationContext = {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };

  try {
    await rfc0502Migrator.transform(data, ctx);
    const ukFile = path.join(
      tmpDir,
      "src",
      "content",
      "surface",
      "authors",
      "uk",
      "andrii-syrokomskyi.md",
    );
    const content = await fs.readFile(ukFile, "utf-8");
    expect(content).toMatchInlineSnapshot(`
      "---
      id: andrii-syrokomskyi
      name: "Andrii Syrokomskyi"
      role: "Редактор"
      bio: "Відповідає за довідник з 2026 року. Досвід у веброзробці та цифровому фундаменті для малого бізнесу."
      contactUrl: "https://warpgogol.com/kontakt"
      ---
      "
    `);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
