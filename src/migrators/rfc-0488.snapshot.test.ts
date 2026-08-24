/*
<MODULE_CONTRACT>
<purpose>RFC-0488: snapshot test for the material credits provenance registry migrator —
verifies transformation on representative credit sidecar fixtures.</purpose>
<keywords>RFC-0488, migrator, snapshot, test, material-credits</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0488: initial snapshot test for material credits migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { rfc0488Migrator } from "./rfc-0488.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0488-snap-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeCreditsFile(dir: string, fileName: string, record: unknown): Promise<string> {
  const assetsDir = path.join(dir, "src", "content", "pages", "de", "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  const filePath = path.join(assetsDir, fileName);
  await fs.writeFile(filePath, stringifyYaml(record), "utf8");
  return filePath;
}

test("rfc-0488 snapshot: ai-generated record with default copyright gets aiUsage.copyrightClaimed: false", async () => {
  await withTempDir(async (dir) => {
    const filePath = await writeCreditsFile(dir, "ai-generated.credits.yaml", {
      id: "warpgogol-promo-video",
      target: { kind: "video", id: "promo-video" },
      sourceType: "ai-generated",
      parties: [
        { role: "promptAuthor", name: "Warpgogol", kind: "Person" },
        { role: "aiPlatform", name: "Runway", kind: "AIPlatform" },
      ],
      license: {
        label: "Alle Rechte vorbehalten",
        copyrightNotice: "Copyright © Warpgogol. All rights reserved.",
      },
    });
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };

    await rfc0488Migrator.transform(data, ctx);
    const raw = await fs.readFile(filePath, "utf8");
    const result = parseYaml(raw) as Record<string, unknown>;

    expect(result.status).toBe("active");
    expect(result.aiUsage).toBeDefined();
    const aiUsage = result.aiUsage as Record<string, unknown>;
    expect(aiUsage.kind).toBe("ai-generated");
    expect(aiUsage.copyrightClaimed).toBe(false);
    expect(typeof aiUsage.humanContribution).toBe("string");
  });
});

test("rfc-0488 snapshot: third-party record gets unverified usageBasis", async () => {
  await withTempDir(async (dir) => {
    const filePath = await writeCreditsFile(dir, "stuttgart-marathon.credits.yaml", {
      id: "stuttgart-marathon-photo",
      target: { kind: "image", id: "stuttgart-marathon" },
      sourceType: "third-party",
      parties: [{ role: "creator", name: "Stuttgart Marathon", kind: "Organization" }],
      license: { label: "Used with permission" },
    });
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };

    await rfc0488Migrator.transform(data, ctx);
    const raw = await fs.readFile(filePath, "utf8");
    const result = parseYaml(raw) as Record<string, unknown>;

    expect(result.status).toBe("active");
    expect(result.usageBasis).toBeDefined();
    const usageBasis = result.usageBasis as Record<string, unknown>;
    expect(usageBasis.type).toBe("unverified");
    expect(usageBasis.note).toBe("Rights review required");
  });
});

test("rfc-0488 snapshot: human-made record with Organization creator gets role renamed and needs-review", async () => {
  await withTempDir(async (dir) => {
    const filePath = await writeCreditsFile(dir, "org-creator.credits.yaml", {
      id: "org-created-image",
      target: { kind: "image", id: "org-image" },
      sourceType: "human-made",
      parties: [{ role: "creator", name: "Warpgogol GmbH", kind: "Organization" }],
      license: { label: "All rights reserved" },
    });
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };

    await rfc0488Migrator.transform(data, ctx);
    const raw = await fs.readFile(filePath, "utf8");
    const result = parseYaml(raw) as Record<string, unknown>;

    const parties = result.parties as Array<{ role: string; kind: string }>;
    expect(parties[0].role).toBe("commissionedBy");
    expect(result.status).toBe("needs-review");
  });
});

test("rfc-0488 snapshot: already-migrated record is a no-op", async () => {
  await withTempDir(async (dir) => {
    const filePath = await writeCreditsFile(dir, "already-migrated.credits.yaml", {
      id: "already-migrated",
      target: { kind: "image", id: "already-migrated" },
      sourceType: "human-made",
      status: "active",
      parties: [{ role: "creator", name: "John", kind: "Person" }],
      license: { label: "MIT" },
    });
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };

    const before = await fs.readFile(filePath, "utf8");
    await rfc0488Migrator.transform(data, ctx);
    const after = await fs.readFile(filePath, "utf8");

    expect(after).toEqual(before);
  });
});
