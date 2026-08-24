/*
<MODULE_CONTRACT>
<purpose>RFC-0502: PBT test for the rfc-0502 migrator — verifies idempotency
(f(f(x)) == f(x)) by running the migrator twice and checking the result is
identical.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0502: initial PBT test for rfc-0502 migrator idempotency.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0502Migrator } from "./rfc-0502.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

function makeCtx(_tmpDir: string): MigrationContext {
  return {
    systemId: "test-system",
    missionId: "test-mission",
    logger: {
      info: () => {},
    },
  };
}

function makeData(tmpDir: string): SternsystemData {
  return {
    rootPath: tmpDir,
    dataPaths: [],
  };
}

test("rfc-0502 migrator is idempotent — f(f(x)) == f(x)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0502-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx(tmpDir);

  try {
    const first = await rfc0502Migrator.transform(data, ctx);
    const firstAuthorsDir = path.join(tmpDir, "src", "content", "surface", "authors");
    const firstFiles = await fs.readdir(firstAuthorsDir).catch(() => []);

    const _second = await rfc0502Migrator.transform(first, ctx);
    const secondAuthorsDir = path.join(tmpDir, "src", "content", "surface", "authors");
    const secondFiles = await fs.readdir(secondAuthorsDir).catch(() => []);

    expect(firstFiles.sort()).toEqual(secondFiles.sort());

    for (const lang of firstFiles) {
      const langDir = path.join(firstAuthorsDir, lang);
      const secondLangDir = path.join(secondAuthorsDir, lang);
      const firstContent = await fs.readFile(path.join(langDir, "andrii-syrokomskyi.md"), "utf-8");
      const secondContent = await fs.readFile(
        path.join(secondLangDir, "andrii-syrokomskyi.md"),
        "utf-8",
      );
      expect(firstContent).toBe(secondContent);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0502 migrator creates author record in de and uk", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0502-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx(tmpDir);

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
    const ukFile = path.join(
      tmpDir,
      "src",
      "content",
      "surface",
      "authors",
      "uk",
      "andrii-syrokomskyi.md",
    );

    const deContent = await fs.readFile(deFile, "utf-8");
    const ukContent = await fs.readFile(ukFile, "utf-8");

    expect(deContent).toContain("id: andrii-syrokomskyi");
    expect(deContent).toContain('name: "Andrii Syrokomskyi"');
    expect(deContent).toContain('role: "Redakteur"');

    expect(ukContent).toContain("id: andrii-syrokomskyi");
    expect(ukContent).toContain('name: "Andrii Syrokomskyi"');
    expect(ukContent).toContain('role: "Редактор"');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0502 migrator does not overwrite existing author record", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0502-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx(tmpDir);

  try {
    const authorsDir = path.join(tmpDir, "src", "content", "surface", "authors", "de");
    await fs.mkdir(authorsDir, { recursive: true });
    const customContent = `---
id: andrii-syrokomskyi
name: "Custom Name"
role: "Custom Role"
bio: "Custom bio"
---
`;
    await fs.writeFile(path.join(authorsDir, "andrii-syrokomskyi.md"), customContent, "utf-8");

    await rfc0502Migrator.transform(data, ctx);

    const after = await fs.readFile(path.join(authorsDir, "andrii-syrokomskyi.md"), "utf-8");
    expect(after).toBe(customContent);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
