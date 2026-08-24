/*
<MODULE_CONTRACT>
  <purpose>RFC-0529: PBT test for the content reference brace-to-braceless migrator —
  verifies idempotency (f(f(x)) == f(x)) over arbitrary SternsystemData with
  brace-delimited content references in markdown and yaml files.</purpose>
  <keywords>RFC-0529, migrator, pbt, idempotency, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0529: initial PBT test for content reference brace-to-braceless migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0529Migrator } from "./rfc-0529.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

const contentArbitrary = fc.oneof(
  fc.string({ minLength: 0, maxLength: 200 }),
  fc.constant(
    "---\ntitle: Test\nbrandName: {business.legal.companyName}\n---\nWelcome to {business.legal.companyName}.\n",
  ),
  fc.constant("---\ntitle: Kontakt\n---\nCall us at {business.contact.phone}.\n"),
  fc.constant("---\ntitle: Home\n---\nNo references here.\n"),
  fc.constant("label: {business.legal.companyName}\nvalue: {business.contact.email}\n"),
);

test("rfc-0529 migrator is idempotent: f(f(x)) == f(x) for arbitrary content", async () => {
  const dataArbitrary = fc.record({
    rootPath: fc.constant(""),
    dataPaths: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 10 }),
    content: contentArbitrary,
    extension: fc.constantFrom(".md", ".yaml"),
  });

  await fc.asyncProperty(dataArbitrary, async (data) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0529-pbt-"));
    try {
      const contentDir = path.join(dir, "src", "content", "business", "de");
      await fs.mkdir(contentDir, { recursive: true });
      const filePath = path.join(contentDir, `test${data.extension}`);
      await fs.writeFile(filePath, data.content);

      const sternData: SternsystemData = { rootPath: dir, dataPaths: data.dataPaths };

      const once = await rfc0529Migrator.transform(sternData, ctx);
      const content1 = await fs.readFile(filePath, "utf8");
      const twice = await rfc0529Migrator.transform(once, ctx);
      const content2 = await fs.readFile(filePath, "utf8");

      expect(content2).toEqual(content1);
      expect(twice).toEqual(once);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
