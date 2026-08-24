/*
<MODULE_CONTRACT>
<purpose>RFC-0479: PBT test for the rfc-0479 bootstrapping migrator — verifies
idempotency (f(f(x)) == f(x)) over the pin cursor transformation.</purpose>
<keywords>RFC-0479, migrator, pbt, idempotency, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0479: initial PBT test for bootstrapping migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0479Migrator, RFC_0479_MIGRATOR_ID } from "../migrators/rfc-0479.ts";
import type { SternsystemData, MigrationContext } from "../migrators/types.ts";

async function withTempPin(cursor: unknown, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0479-pbt-"));
  const pinPath = path.join(dir, "system.pin.json");
  await fs.writeFile(pinPath, JSON.stringify({ migratorCursor: cursor }, null, 2));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

test("rfc-0479 migrator is idempotent: f(f(x)) == f(x) for string cursor", async () => {
  await fc.asyncProperty(fc.string({ minLength: 1 }), async (version) => {
    await withTempPin(version, async (dir) => {
      const data: SternsystemData = { rootPath: dir, dataPaths: [] };
      const once = await rfc0479Migrator.transform(data, ctx);
      const twice = await rfc0479Migrator.transform(once, ctx);
      const pin1 = JSON.parse(await fs.readFile(path.join(dir, "system.pin.json"), "utf8"));
      expect(pin1.migratorCursor).toEqual([RFC_0479_MIGRATOR_ID]);
      // Second application should be a no-op
      expect(twice).toEqual(once);
    });
  });
});

test("rfc-0479 migrator is idempotent: f(f(x)) == f(x) for null cursor", async () => {
  await withTempPin(null, async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const once = await rfc0479Migrator.transform(data, ctx);
    const twice = await rfc0479Migrator.transform(once, ctx);
    const pin = JSON.parse(await fs.readFile(path.join(dir, "system.pin.json"), "utf8"));
    expect(pin.migratorCursor).toEqual([RFC_0479_MIGRATOR_ID]);
    expect(twice).toEqual(once);
  });
});

test("rfc-0479 migrator is idempotent: f(f(x)) == f(x) for array cursor", async () => {
  await withTempPin(["rfc-0479"], async (dir) => {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const once = await rfc0479Migrator.transform(data, ctx);
    const twice = await rfc0479Migrator.transform(once, ctx);
    const pin = JSON.parse(await fs.readFile(path.join(dir, "system.pin.json"), "utf8"));
    expect(pin.migratorCursor).toEqual(["rfc-0479"]);
    expect(twice).toEqual(once);
  });
});
