/*
<MODULE_CONTRACT>
  <purpose>RFC-0529: snapshot test for the content reference brace-to-braceless migrator —
  verifies that applying the migrator converts brace-delimited references to braceless syntax,
  and that a second application is idempotent.</purpose>
  <keywords>RFC-0529, migrator, snapshot, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0529: initial snapshot test for content reference brace-to-braceless migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
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

async function withTempWorkpiece(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0529-snap-"));
  const businessDir = path.join(dir, "src", "content", "business", "de");
  await fs.mkdir(businessDir, { recursive: true });
  await fs.writeFile(
    path.join(businessDir, "legal.md"),
    "---\ntitle: Legal\ncompanyName: Test GmbH\n---\n",
  );
  await fs.writeFile(
    path.join(businessDir, "contact.md"),
    "---\ntitle: Kontakt\nphone: +49 123\nemail: test@example.com\n---\n",
  );
  await fs.writeFile(
    path.join(businessDir, "offer.md"),
    "---\ntitle: Angebot\nbrandName: {business.legal.companyName}\nbankAccountHolder: {business.legal.companyName}\n---\nCall {business.contact.phone} or email {business.contact.email}.\n",
  );
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("rfc-0529 snapshot: migrator converts brace-delimited references to braceless", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const filePath = path.join(dir, "src", "content", "business", "de", "offer.md");

    await rfc0529Migrator.transform(data, ctx);

    const after = await fs.readFile(filePath, "utf8");
    expect(after).toContain("brandName: business.legal.companyName");
    expect(after).toContain("bankAccountHolder: business.legal.companyName");
    expect(after).toContain("Call business.contact.phone or email business.contact.email.");
    expect(after).not.toContain("{business.legal.companyName}");
    expect(after).not.toContain("{business.contact.phone}");
    expect(after).not.toContain("{business.contact.email}");
  });
});

test("rfc-0529 snapshot: migrator is idempotent", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const filePath = path.join(dir, "src", "content", "business", "de", "offer.md");

    const once = await rfc0529Migrator.transform(data, ctx);
    const content1 = await fs.readFile(filePath, "utf8");
    const twice = await rfc0529Migrator.transform(once, ctx);
    const content2 = await fs.readFile(filePath, "utf8");

    expect(content2).toEqual(content1);
    expect(twice).toEqual(once);
  });
});

test("rfc-0529 snapshot: migrator skips files without brace references", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const legalPath = path.join(dir, "src", "content", "business", "de", "legal.md");
    const before = await fs.readFile(legalPath, "utf8");

    await rfc0529Migrator.transform(data, ctx);
    const after = await fs.readFile(legalPath, "utf8");

    expect(after).toEqual(before);
  });
});
