/*
<MODULE_CONTRACT>
<purpose>RFC-0481: snapshot test for the rfc-0481 content migrator — verifies
the business singleton transformation produces deterministic output on real
warpgogol-com business/de/company.md data.</purpose>
<keywords>RFC-0481, migrator, snapshot, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0481: initial snapshot test for content migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0481Migrator } from "./rfc-0481.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "warpgogol-com",
  missionId: "test-mission",
  logger: { info: () => {} },
};

const REAL_COMPANY_MD = `---
id: Warpgogol
mode: bodenstation
businessType: founder-led-engineering-studio
industry: web-engineering-for-handwerk-and-small-business
market: b2b
jurisdiction: Germany
brand:
  name: "Warpgogol"
  author: Andrii Syrokomskyi
tagline: "Digitales Fundament — tragfähige digitale Basis für kleines Gewerbe und Handwerk"
foundingYear: "2026"
areaServed:
  - Baden-Württemberg
  - Backnang
  - Deutschland
description: >-
  Warpgogol baut Digitales Fundament: tragfähige digitale Basis für kleines Gewerbe
  und Handwerk in Deutschland. Offener Preis, schriftliche Bedingungen, Notausgang
  und persönliche Verantwortung des Gründers.
mission: >-
  Eine geordnete, dauerhaft betreute digitale Präsenz für kleine Unternehmen
  bereitstellen — als unterstützte Infrastruktur, nicht als einmaliges Projekt.
---
`;

async function withTempWorkpiece(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0481-snap-"));
  const businessDir = path.join(dir, "src", "content", "business", "de");
  const profileDir = path.join(dir, "src", "content", "business-profile", "de");
  const systemDir = path.join(dir, "src", "content");
  await fs.mkdir(businessDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    path.join(systemDir, "system.md"),
    `---\ni18n:\n  default: de\n  supported:\n    de:\n      name: Deutsch\n    uk:\n      name: Українська\n---\n`,
  );
  await fs.writeFile(path.join(businessDir, "company.md"), REAL_COMPANY_MD);
  const ukBusinessDir = path.join(dir, "src", "content", "business", "uk");
  const ukProfileDir = path.join(dir, "src", "content", "business-profile", "uk");
  await fs.mkdir(ukBusinessDir, { recursive: true });
  await fs.mkdir(ukProfileDir, { recursive: true });
  await fs.writeFile(
    path.join(ukBusinessDir, "company.md"),
    `---
mode: bodenstation
brand:
  author: Андрій Сирокомський
description: >-
  Ukrainian description.
mission: >-
  Ukrainian mission.
---
`,
  );
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("snapshot: rfc-0481 creates business-profile/de/business.md from real company.md", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0481Migrator.transform(data, ctx);

    const businessPath = path.join(dir, "src", "content", "business-profile", "de", "business.md");
    const content = await fs.readFile(businessPath, "utf8");

    expect(content).toContain("schema: pbp/business@1");
    expect(content).toContain("type: business");
    expect(content).toContain("status: published");
    expect(content).toContain("name: Warpgogol");
    expect(content).toContain("yearEstablished: 2026");
    expect(content).toContain("brandRefs:");
    expect(content).toContain("legalIdentityRef:");
    expect(content).toContain("placeRefs:");
    expect(content).toContain("contactPointRefs:");
    expect(content).toContain("webPresenceRefs:");
    expect(content).toContain("governance:");
    expect(content).toContain("authorityRef:");
    expect(content).toContain("reviewEvery: P1Y");
  });
});

test("snapshot: rfc-0481 creates business-profile/uk/business.md from uk company.md", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0481Migrator.transform(data, ctx);

    const businessPath = path.join(dir, "src", "content", "business-profile", "uk", "business.md");
    const content = await fs.readFile(businessPath, "utf8");

    expect(content).toContain("schema: pbp/business@1");
    expect(content).toContain("type: business");
    expect(content).toContain("status: published");
  });
});

test("snapshot: rfc-0481 is idempotent on real data — second run is no-op", async () => {
  await withTempWorkpiece(async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0481Migrator.transform(data, ctx);

    const businessPath = path.join(dir, "src", "content", "business-profile", "de", "business.md");
    const content1 = await fs.readFile(businessPath, "utf8");

    await rfc0481Migrator.transform(data, ctx);
    const content2 = await fs.readFile(businessPath, "utf8");

    expect(content2).toEqual(content1);
  });
});

test("snapshot: rfc-0481 throws MigrationError when company.md is missing", async () => {
  await withTempWorkpiece(async (dir) => {
    await fs.rm(path.join(dir, "src", "content", "business", "uk", "company.md"));
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await expect(rfc0481Migrator.transform(data, ctx)).rejects.toThrow();
  });
});
