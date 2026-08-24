/*
<MODULE_CONTRACT>
  <purpose>RFC-0572: snapshot test for the contact form revert migrator —
  verifies that applying the migrator removes emailField/phoneField and re-adds
  contactRequirementMessage, and that a second application is idempotent.</purpose>
  <keywords>RFC-0572, migrator, snapshot, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0572: initial snapshot test for contact form revert migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0572Migrator } from "./rfc-0572.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

async function withTempWorkpiece(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0572-snap-"));
  const pagesDir = path.join(dir, "src", "content", "pages", "de");
  await fs.mkdir(pagesDir, { recursive: true });
  await fs.writeFile(
    path.join(pagesDir, "kontakt.md"),
    "---\ntitle: Kontakt\nsections:\n  - id: send-message\n    props:\n      header:\n        heading: Schreiben Sie uns\n      placeholder: Ihre Nachricht\n      buttonLabel: Senden\n      successMessage: Gesendet\n      errorMessage: Fehler\n      emailField:\n        enabled: true\n        required: true\n        label: E-Mail\n        placeholder: ihre@email.de\n      phoneField:\n        enabled: true\n        required: false\n        label: Telefon\n        placeholder: +49 ...\n---\n",
  );
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("rfc-0572 snapshot: migrator removes emailField/phoneField and re-adds contactRequirementMessage", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const filePath = path.join(dir, "src", "content", "pages", "de", "kontakt.md");

    await rfc0572Migrator.transform(data, ctx);

    const after = await fs.readFile(filePath, "utf8");
    expect(after).not.toContain("emailField:");
    expect(after).not.toContain("phoneField:");
    expect(after).toContain("contactRequirementMessage:");
  });
});

test("rfc-0572 snapshot: migrator is idempotent", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const filePath = path.join(dir, "src", "content", "pages", "de", "kontakt.md");

    const once = await rfc0572Migrator.transform(data, ctx);
    const content1 = await fs.readFile(filePath, "utf8");
    const twice = await rfc0572Migrator.transform(once, ctx);
    const content2 = await fs.readFile(filePath, "utf8");

    expect(content2).toEqual(content1);
    expect(twice).toEqual(once);
  });
});

test("rfc-0572 snapshot: migrator is no-op on blocks without structured fields", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0572-noop-"));
  try {
    const pagesDir = path.join(dir, "src", "content", "pages", "de");
    await fs.mkdir(pagesDir, { recursive: true });
    const original =
      "---\ntitle: Kontakt\nsections:\n  - id: send-message\n    props:\n      placeholder: Nachricht\n      contactRequirementMessage: Bitte Kontakt\n---\n";
    await fs.writeFile(path.join(pagesDir, "kontakt.md"), original);

    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0572Migrator.transform(data, ctx);

    const after = await fs.readFile(path.join(pagesDir, "kontakt.md"), "utf8");
    expect(after).toEqual(original);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
