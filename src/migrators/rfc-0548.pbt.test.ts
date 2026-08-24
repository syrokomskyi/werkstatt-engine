/*
<MODULE_CONTRACT>
<purpose>RFC-0548: property-based test for the rfc-0548 migrator — verifies
idempotency (f(f(x)) == f(x)) and backup behavior.</purpose>
<non-goals>
  <item>Do not test forge.agents.generate integration — that is tested separately.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0548: initial PBT for rfc-0548 migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rfc0548Migrator } from "../migrators/rfc-0548.ts";
import type { SternsystemData, MigrationContext } from "../migrators/types.ts";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rfc-0548-pbt-"));
}

function makeCtx(): MigrationContext {
  return {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };
}

function makeData(rootPath: string): SternsystemData {
  return { rootPath, dataPaths: [] };
}

test("rfc-0548 migrator is idempotent — f(f(x)) == f(x)", async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), fc.boolean(), async (hasAgentsMd, hasGeneratedMarker) => {
      const dir = makeTempDir();
      try {
        if (hasAgentsMd) {
          const content = hasGeneratedMarker
            ? "<!-- generated-by: forge.agents.generate -->\n# Agent Guide\n"
            : "# Hand-written Agent Guide\n";
          fs.writeFileSync(path.join(dir, "AGENTS.md"), content, "utf8");
        }

        const data = makeData(dir);
        const ctx = makeCtx();

        const first = await rfc0548Migrator.transform(data, ctx);
        const second = await rfc0548Migrator.transform(first, ctx);

        // Both transforms should return the same data
        expect(second.rootPath).toBe(first.rootPath);
        expect(second.dataPaths).toEqual(first.dataPaths);

        // Backup should exist if AGENTS.md existed
        if (hasAgentsMd) {
          expect(fs.existsSync(path.join(dir, "AGENTS.md.bak"))).toBe(true);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }),
    { numRuns: 50 },
  );
});

test("rfc-0548 migrator creates backup when AGENTS.md exists", async () => {
  const dir = makeTempDir();
  try {
    const content = "<!-- generated-by: forge.agents.generate -->\n# Agent Guide\n";
    fs.writeFileSync(path.join(dir, "AGENTS.md"), content, "utf8");

    const data = makeData(dir);
    const ctx = makeCtx();

    await rfc0548Migrator.transform(data, ctx);

    expect(fs.existsSync(path.join(dir, "AGENTS.md.bak"))).toBe(true);
    const backup = fs.readFileSync(path.join(dir, "AGENTS.md.bak"), "utf8");
    expect(backup).toBe(content);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rfc-0548 migrator is a no-op when AGENTS.md does not exist", async () => {
  const dir = makeTempDir();
  try {
    const data = makeData(dir);
    const ctx = makeCtx();

    const result = await rfc0548Migrator.transform(data, ctx);

    expect(result.rootPath).toBe(dir);
    expect(fs.existsSync(path.join(dir, "AGENTS.md.bak"))).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rfc-0548 migrator backs up but does not modify hand-written AGENTS.md", async () => {
  const dir = makeTempDir();
  try {
    const content = "# Hand-written Agent Guide\nNo generated marker here.\n";
    fs.writeFileSync(path.join(dir, "AGENTS.md"), content, "utf8");

    const data = makeData(dir);
    const ctx = makeCtx();

    await rfc0548Migrator.transform(data, ctx);

    // Backup should exist
    expect(fs.existsSync(path.join(dir, "AGENTS.md.bak"))).toBe(true);
    // AGENTS.md should be unchanged
    const after = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(after).toBe(content);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
