/*
<MODULE_CONTRACT>
  <purpose>RFC-0514: PBT test for the contact form structured fields migrator —
  verifies idempotency (f(f(x)) == f(x)) over arbitrary SternsystemData with
  send-message page blocks.</purpose>
  <keywords>RFC-0514, migrator, pbt, idempotency, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0514: initial PBT test for contact form structured fields migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0514Migrator } from "./rfc-0514.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

const pageContentArbitrary = fc.oneof(
  fc.string({ minLength: 0, maxLength: 200 }),
  fc.constant(
    "---\ntitle: Kontakt\nsections:\n  - id: send-message\n    props:\n      placeholder: Nachricht\n      contactRequirementMessage: Bitte Kontakt\n---\n",
  ),
  fc.constant(
    "---\ntitle: Contact\nsections:\n  - id: send-message\n    props:\n      emailField:\n        enabled: true\n        required: true\n---\n",
  ),
  fc.constant("---\ntitle: Home\n---\nNo send-message here.\n"),
);

test("rfc-0514 migrator is idempotent: f(f(x)) == f(x) for arbitrary page content", async () => {
  const dataArbitrary = fc.record({
    rootPath: fc.constant(""),
    dataPaths: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 10 }),
    pageContent: pageContentArbitrary,
  });

  await fc.asyncProperty(dataArbitrary, async (data) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0514-pbt-"));
    try {
      const pagesDir = path.join(dir, "src", "content", "pages", "de");
      await fs.mkdir(pagesDir, { recursive: true });
      await fs.writeFile(path.join(pagesDir, "kontakt.md"), data.pageContent);

      const sternData: SternsystemData = { rootPath: dir, dataPaths: data.dataPaths };

      const once = await rfc0514Migrator.transform(sternData, ctx);
      const content1 = await fs.readFile(path.join(pagesDir, "kontakt.md"), "utf8");
      const twice = await rfc0514Migrator.transform(once, ctx);
      const content2 = await fs.readFile(path.join(pagesDir, "kontakt.md"), "utf8");

      expect(content2).toEqual(content1);
      expect(twice).toEqual(once);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
