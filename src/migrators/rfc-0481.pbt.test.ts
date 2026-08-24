/*
<MODULE_CONTRACT>
<purpose>RFC-0481: PBT test for the rfc-0481 content migrator — verifies
idempotency (f(f(x)) == f(x)) over the business singleton transformation.</purpose>
<keywords>RFC-0481, migrator, pbt, idempotency, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0481: initial PBT test for content migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0481Migrator } from "./rfc-0481.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

async function withTempWorkpiece(
  companyFrontmatter: string,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0481-pbt-"));
  const businessDir = path.join(dir, "src", "content", "business", "de");
  const profileDir = path.join(dir, "src", "content", "business-profile", "de");
  const systemDir = path.join(dir, "src", "content");
  await fs.mkdir(businessDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(
    path.join(systemDir, "system.md"),
    `---\ni18n:\n  default: de\n  supported:\n    de:\n      name: Deutsch\n---\n`,
  );
  await fs.writeFile(path.join(businessDir, "company.md"), companyFrontmatter);
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const companyArbitrary = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  description: fc.string({ minLength: 1, maxLength: 200 }),
  mission: fc.string({ minLength: 1, maxLength: 200 }),
  foundingYear: fc.constantFrom("2020", "2021", "2022", "2023", "2024", "2025", "2026"),
});

test("rfc-0481 migrator is idempotent: f(f(x)) == f(x) for random company.md", async () => {
  await fc.asyncProperty(companyArbitrary, async (company) => {
    const frontmatter = `---
brand:
  name: "${company.name}"
foundingYear: "${company.foundingYear}"
description: >-
  ${company.description}
mission: >-
  ${company.mission}
---
`;
    await withTempWorkpiece(frontmatter, async (dir) => {
      const data: SternsystemData = { rootPath: dir, dataPaths: [] };
      const once = await rfc0481Migrator.transform(data, ctx);
      const businessPath = path.join(
        dir,
        "src",
        "content",
        "business-profile",
        "de",
        "business.md",
      );
      const content1 = await fs.readFile(businessPath, "utf8");
      const twice = await rfc0481Migrator.transform(once, ctx);
      const content2 = await fs.readFile(businessPath, "utf8");
      expect(content2).toEqual(content1);
      expect(twice).toEqual(once);
    });
  });
});

test("rfc-0481 migrator creates valid PBP business entity", async () => {
  const frontmatter = `---
brand:
  name: "Test Company"
foundingYear: "2024"
description: >-
  A test description.
mission: >-
  A test mission.
---
`;
  await withTempWorkpiece(frontmatter, async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0481Migrator.transform(data, ctx);
    const businessPath = path.join(dir, "src", "content", "business-profile", "de", "business.md");
    const content = await fs.readFile(businessPath, "utf8");
    expect(content).toContain("schema: pbp/business@1");
    expect(content).toContain("type: business");
    expect(content).toContain("status: published");
    expect(content).toContain("name: Test Company");
    expect(content).toContain("yearEstablished: 2024");
  });
});
