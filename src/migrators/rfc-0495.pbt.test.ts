/*
<MODULE_CONTRACT>
<purpose>RFC-0495: PBT test for the no-op migrator — verifies idempotency
(f(f(x)) == f(x)) over arbitrary SternsystemData.</purpose>
<keywords>RFC-0495, migrator, pbt, idempotency, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0495: initial PBT test for no-op migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0495Migrator } from "./rfc-0495.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

test("rfc-0495 migrator is idempotent: f(f(x)) == f(x) for arbitrary data", async () => {
  const dataArbitrary = fc.record({
    rootPath: fc.string({ minLength: 1, maxLength: 100 }),
    dataPaths: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 10 }),
  });

  await fc.asyncProperty(dataArbitrary, async (data) => {
    const once = await rfc0495Migrator.transform(data as SternsystemData, ctx);
    const twice = await rfc0495Migrator.transform(once, ctx);
    expect(twice).toEqual(once);
  });
});

test("rfc-0495 migrator is a no-op: returns data unchanged", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0495-pbt-"));
  try {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const result = await rfc0495Migrator.transform(data, ctx);
    expect(result).toBe(data);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
