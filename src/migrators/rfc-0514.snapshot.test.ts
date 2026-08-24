/*
<MODULE_CONTRACT>
  <purpose>RFC-0514: snapshot test for the contact form structured fields migrator —
  verifies that applying the migrator adds emailField and removes contactRequirementMessage,
  and that a second application is idempotent.</purpose>
  <keywords>RFC-0514, migrator, snapshot, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0514: initial snapshot test for contact form structured fields migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
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

async function withTempWorkpiece(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0514-snap-"));
  const pagesDir = path.join(dir, "src", "content", "pages", "de");
  await fs.mkdir(pagesDir, { recursive: true });
  await fs.writeFile(
    path.join(pagesDir, "kontakt.md"),
    "---\ntitle: Kontakt\nsections:\n  - id: send-message\n    props:\n      header:\n        heading: Schreiben Sie uns\n      placeholder: Ihre Nachricht\n      buttonLabel: Senden\n      successMessage: Gesendet\n      errorMessage: Fehler\n      contactRequirementMessage: Bitte hinterlassen Sie Kontakt\n---\n",
  );
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("rfc-0514 snapshot: migrator adds emailField and removes contactRequirementMessage", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const filePath = path.join(dir, "src", "content", "pages", "de", "kontakt.md");

    await rfc0514Migrator.transform(data, ctx);

    const after = await fs.readFile(filePath, "utf8");
    expect(after).toContain("emailField:");
    expect(after).toContain("enabled: true");
    expect(after).not.toContain("contactRequirementMessage");
  });
});

test("rfc-0514 snapshot: migrator is idempotent", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const filePath = path.join(dir, "src", "content", "pages", "de", "kontakt.md");

    const once = await rfc0514Migrator.transform(data, ctx);
    const content1 = await fs.readFile(filePath, "utf8");
    const twice = await rfc0514Migrator.transform(once, ctx);
    const content2 = await fs.readFile(filePath, "utf8");

    expect(content2).toEqual(content1);
    expect(twice).toEqual(once);
  });
});
