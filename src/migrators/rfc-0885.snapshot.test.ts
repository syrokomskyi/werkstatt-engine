/*
<MODULE_CONTRACT>
  <purpose>RFC-0885: snapshot test for the PBP evidence schema migrator —
  verifies consentStatus→consentScope mapping and evidence-source display
  defaults on concrete fixtures.</purpose>
  <keywords>RFC-0885, migrator, snapshot, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1105: initial snapshot test for rfc-0885 migrator (validator requires adjacent pbt+snapshot pair).</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0885Migrator } from "./rfc-0885.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

test("rfc-0885 snapshot: granted consent maps to document-granted scope", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0885-snap-"));
  try {
    const consentDir = path.join(dir, "src", "content", "business-profile", "de", "consent");
    await fs.mkdir(consentDir, { recursive: true });
    const filePath = path.join(consentDir, "c.md");
    await fs.writeFile(
      filePath,
      "---\nconsentStatus: granted\ngrantedAt: 2026-01-01T00:00:00Z\nmethod: written\n---\nBody",
    );

    await rfc0885Migrator.transform({ rootPath: dir, dataPaths: [] }, ctx);

    const after = await fs.readFile(filePath, "utf8");
    expect(after).toContain("consentScope:");
    expect(after).toContain("status: granted");
    expect(after).not.toContain("consentStatus:");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("rfc-0885 snapshot: Nachweis evidence-source gets default display", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0885-snap-es-"));
  try {
    const esDir = path.join(dir, "src", "content", "business-profile", "de", "evidence-source");
    await fs.mkdir(esDir, { recursive: true });
    const filePath = path.join(esDir, "e.md");
    await fs.writeFile(filePath, "---\nkind: client-statement\n---\nBody");

    await rfc0885Migrator.transform({ rootPath: dir, dataPaths: [] }, ctx);

    const after = await fs.readFile(filePath, "utf8");
    expect(after).toContain("display:");
    expect(after).toContain('document: "visible"'.replace(/"/g, ""));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
