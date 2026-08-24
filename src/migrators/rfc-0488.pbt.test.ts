/*
<MODULE_CONTRACT>
<purpose>RFC-0488: PBT test for the material credits provenance registry migrator —
verifies idempotency (f(f(x)) == f(x)) over credit sidecar transformations.</purpose>
<keywords>RFC-0488, migrator, pbt, idempotency, test, material-credits</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0488: initial PBT test for material credits migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0488Migrator } from "./rfc-0488.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

const SOURCE_TYPES = [
  "human-made",
  "ai-assisted",
  "ai-generated",
  "composite",
  "third-party",
  "commissioned",
  "licensed-third-party",
  "customer-supplied",
  "public-domain",
  "screenshot",
] as const;

const PARTY_KINDS = ["Person", "Organization", "AIAgent", "AIModel", "AIPlatform"] as const;
const PARTY_ROLES = [
  "creator",
  "coCreator",
  "commissionedBy",
  "producer",
  "promptAuthor",
  "reviewer",
  "approver",
  "rightsHolder",
  "editor",
  "contributor",
  "photographer",
  "illustrator",
] as const;

const sourceTypeArb = fc.constantFrom(...SOURCE_TYPES);
const partyArb = fc.record({
  role: fc.constantFrom(...PARTY_ROLES),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  kind: fc.constantFrom(...PARTY_KINDS),
});

const creditRecordArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  sourceType: sourceTypeArb,
  parties: fc.array(partyArb, { minLength: 1, maxLength: 4 }),
  license: fc.record({
    label: fc.string({ minLength: 1, maxLength: 20 }),
    copyrightNotice: fc.option(fc.constant("Copyright © Warpgogol. All rights reserved.")),
  }),
});

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0488-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeCreditsFile(dir: string, record: unknown): Promise<string> {
  const assetsDir = path.join(dir, "src", "content", "pages", "de", "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  const filePath = path.join(assetsDir, "test-image.credits.yaml");
  const { stringify } = await import("yaml");
  await fs.writeFile(filePath, stringify(record), "utf8");
  return filePath;
}

async function readCreditsFile(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  const { parse } = await import("yaml");
  return parse(raw) as Record<string, unknown>;
}

test("rfc-0488 migrator is idempotent: f(f(x)) == f(x) for random credit records", async () => {
  await fc.asyncProperty(creditRecordArb, async (record) => {
    await withTempDir(async (dir) => {
      const filePath = await writeCreditsFile(dir, record);
      const data: SternsystemData = { rootPath: dir, dataPaths: [] };

      await rfc0488Migrator.transform(data, ctx);
      const content1 = await readCreditsFile(filePath);

      await rfc0488Migrator.transform(data, ctx);
      const content2 = await readCreditsFile(filePath);

      expect(content2).toEqual(content1);
    });
  });
});

test("rfc-0488 migrator adds status: active to records without status", async () => {
  await withTempDir(async (dir) => {
    const filePath = await writeCreditsFile(dir, {
      id: "test",
      sourceType: "human-made",
      parties: [{ role: "creator", name: "Test", kind: "Person" }],
      license: { label: "MIT" },
    });
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };

    await rfc0488Migrator.transform(data, ctx);
    const result = await readCreditsFile(filePath);

    expect(result.status).toBe("active");
  });
});

test("rfc-0488 migrator adds aiUsage to ai-generated records with default copyright", async () => {
  await withTempDir(async (dir) => {
    const filePath = await writeCreditsFile(dir, {
      id: "test-ai",
      sourceType: "ai-generated",
      parties: [{ role: "aiPlatform", name: "Midjourney", kind: "AIPlatform" }],
      license: {
        label: "Alle Rechte vorbehalten",
        copyrightNotice: "Copyright © Warpgogol. All rights reserved.",
      },
    });
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };

    await rfc0488Migrator.transform(data, ctx);
    const result = await readCreditsFile(filePath);

    expect(result.aiUsage).toBeDefined();
    expect((result.aiUsage as Record<string, unknown>).kind).toBe("ai-generated");
    expect((result.aiUsage as Record<string, unknown>).copyrightClaimed).toBe(false);
  });
});

test("rfc-0488 migrator sets copyrightClaimed: true when Person creator exists", async () => {
  await withTempDir(async (dir) => {
    const filePath = await writeCreditsFile(dir, {
      id: "test-ai-person",
      sourceType: "ai-generated",
      parties: [
        { role: "creator", name: "John Doe", kind: "Person" },
        { role: "aiPlatform", name: "Midjourney", kind: "AIPlatform" },
      ],
      license: {
        label: "Alle Rechte vorbehalten",
        copyrightNotice: "Copyright © Warpgogol. All rights reserved.",
      },
    });
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };

    await rfc0488Migrator.transform(data, ctx);
    const result = await readCreditsFile(filePath);

    expect(result.aiUsage).toBeDefined();
    expect((result.aiUsage as Record<string, unknown>).copyrightClaimed).toBe(true);
  });
});

test("rfc-0488 migrator adds unverified usageBasis to third-party records", async () => {
  await withTempDir(async (dir) => {
    const filePath = await writeCreditsFile(dir, {
      id: "test-third-party",
      sourceType: "third-party",
      parties: [{ role: "creator", name: "Someone", kind: "Person" }],
      license: { label: "Fair Use" },
    });
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };

    await rfc0488Migrator.transform(data, ctx);
    const result = await readCreditsFile(filePath);

    expect(result.usageBasis).toBeDefined();
    expect((result.usageBasis as Record<string, unknown>).type).toBe("unverified");
  });
});

test("rfc-0488 migrator renames Organization creator to commissionedBy for human-made records", async () => {
  await withTempDir(async (dir) => {
    const filePath = await writeCreditsFile(dir, {
      id: "test-org-creator",
      sourceType: "human-made",
      parties: [{ role: "creator", name: "Warpgogol Inc", kind: "Organization" }],
      license: { label: "All rights reserved" },
    });
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };

    await rfc0488Migrator.transform(data, ctx);
    const result = await readCreditsFile(filePath);

    const parties = result.parties as Array<{ role: string; kind: string }>;
    expect(parties[0].role).toBe("commissionedBy");
    expect(result.status).toBe("needs-review");
  });
});
