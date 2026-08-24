/*
<MODULE_CONTRACT>
<purpose>RFC-0492: PBT test for the rfc-0492 industry dossier migrator — verifies
idempotency (f(f(x)) == f(x)) over the deprecated→new field copy transformation.</purpose>
<keywords>RFC-0492, migrator, pbt, idempotency, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0492: initial PBT test for industry dossier migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0492Migrator } from "./rfc-0492.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

async function withTempWorkpiece(
  industryFrontmatter: string,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0492-pbt-"));
  const industriesDir = path.join(dir, "src", "content", "surface", "industries", "de");
  await fs.mkdir(industriesDir, { recursive: true });
  await fs.writeFile(path.join(industriesDir, "elektriker.md"), industryFrontmatter);
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const stringListArbitrary = fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
  maxLength: 10,
});

const faqArbitrary = fc.array(
  fc.record({
    question: fc.string({ minLength: 1, maxLength: 100 }),
    answer: fc.string({ minLength: 1, maxLength: 200 }),
  }),
  { maxLength: 5 },
);

const industryArbitrary = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  slug: fc.constant("elektriker"),
  proofSignals: stringListArbitrary,
  faqs: faqArbitrary,
  painPoints: stringListArbitrary,
  hasNewFields: fc.boolean(),
});

test("rfc-0492 migrator is idempotent: f(f(x)) == f(x) for random industry records", async () => {
  await fc.asyncProperty(industryArbitrary, async (industry) => {
    const newFieldsBlock = industry.hasNewFields
      ? `trustSignals:\n  - "already present"\nindustryFaq:\n  - question: "existing"\n    answer: "yes"\nevidenceRequirements:\n  - "already here"\n`
      : "";
    const frontmatter = `---
name: "${industry.name}"
slug: ${industry.slug}
proofSignals:
${industry.proofSignals.map((s) => `  - "${s}"`).join("\n")}
faqs:
${industry.faqs.map((f) => `  - question: "${f.question}"\n    answer: "${f.answer}"`).join("\n")}
painPoints:
${industry.painPoints.map((s) => `  - "${s}"`).join("\n")}
${newFieldsBlock}---
`;
    await withTempWorkpiece(frontmatter, async (dir) => {
      const data: SternsystemData = { rootPath: dir, dataPaths: [] };
      const once = await rfc0492Migrator.transform(data, ctx);
      const filePath = path.join(
        dir,
        "src",
        "content",
        "surface",
        "industries",
        "de",
        "elektriker.md",
      );
      const content1 = await fs.readFile(filePath, "utf8");
      const twice = await rfc0492Migrator.transform(once, ctx);
      const content2 = await fs.readFile(filePath, "utf8");
      expect(content2).toEqual(content1);
      expect(twice).toEqual(once);
    });
  });
});

test("rfc-0492 migrator copies proofSignals → trustSignals when absent", async () => {
  const frontmatter = `---
name: "Elektriker"
slug: elektriker
proofSignals:
  - "Meisterbetrieb"
  - "24h Notdienst"
faqs:
  - question: "Was kostet eine Erstberatung?"
    answer: "Die Erstberatung ist kostenlos."
painPoints:
  - "Unzuverlässige Termine"
  - "Unklare Preise"
---
`;
  await withTempWorkpiece(frontmatter, async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0492Migrator.transform(data, ctx);
    const content = await fs.readFile(
      path.join(dir, "src", "content", "surface", "industries", "de", "elektriker.md"),
      "utf8",
    );
    expect(content).toContain("trustSignals:");
    expect(content).toContain("Meisterbetrieb");
    expect(content).toContain("industryFaq:");
    expect(content).toContain("evidenceRequirements:");
    expect(content).toContain("Unzuverlässige Termine");
  });
});

test("rfc-0492 migrator does NOT overwrite existing new fields", async () => {
  const frontmatter = `---
name: "Elektriker"
slug: elektriker
proofSignals:
  - "old signal"
trustSignals:
  - "new signal"
---
`;
  await withTempWorkpiece(frontmatter, async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0492Migrator.transform(data, ctx);
    const content = await fs.readFile(
      path.join(dir, "src", "content", "surface", "industries", "de", "elektriker.md"),
      "utf8",
    );
    expect(content).toContain("new signal");
    expect(content).toContain("trustSignals:");
    expect(content).not.toMatch(/trustSignals:[\s\S]*old signal/);
  });
});

test("rfc-0492 migrator does NOT set notdienst", async () => {
  const frontmatter = `---
name: "Elektriker"
slug: elektriker
proofSignals:
  - "signal"
---
`;
  await withTempWorkpiece(frontmatter, async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0492Migrator.transform(data, ctx);
    const content = await fs.readFile(
      path.join(dir, "src", "content", "surface", "industries", "de", "elektriker.md"),
      "utf8",
    );
    expect(content).not.toContain("notdienst");
  });
});
