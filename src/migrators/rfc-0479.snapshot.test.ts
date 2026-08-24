/*
<MODULE_CONTRACT>
<purpose>RFC-0479: snapshot test for the rfc-0479 bootstrapping migrator — verifies
the pin cursor transformation produces deterministic output on real data shapes.</purpose>
<keywords>RFC-0479, migrator, snapshot, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0479: initial snapshot test for bootstrapping migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0479Migrator, RFC_0479_MIGRATOR_ID } from "./rfc-0479.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

async function withTempPin(cursor: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0479-snap-"));
  await fs.writeFile(
    path.join(dir, "system.pin.json"),
    JSON.stringify({ migratorCursor: cursor }, null, 2),
  );
  return dir;
}

test("snapshot: string cursor '4.5.0' transforms to ['rfc-0479']", async () => {
  const dir = await withTempPin("4.5.0");
  try {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0479Migrator.transform(data, ctx);
    const pin = JSON.parse(await fs.readFile(path.join(dir, "system.pin.json"), "utf8"));
    expect(pin.migratorCursor).toEqual([RFC_0479_MIGRATOR_ID]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("snapshot: null cursor transforms to ['rfc-0479']", async () => {
  const dir = await withTempPin(null);
  try {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0479Migrator.transform(data, ctx);
    const pin = JSON.parse(await fs.readFile(path.join(dir, "system.pin.json"), "utf8"));
    expect(pin.migratorCursor).toEqual([RFC_0479_MIGRATOR_ID]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("snapshot: array cursor ['rfc-0479'] is no-op", async () => {
  const dir = await withTempPin(["rfc-0479"]);
  try {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0479Migrator.transform(data, ctx);
    const pin = JSON.parse(await fs.readFile(path.join(dir, "system.pin.json"), "utf8"));
    expect(pin.migratorCursor).toEqual(["rfc-0479"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("snapshot: missing pin file is no-op", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0479-snap-"));
  try {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0479Migrator.transform(data, ctx);
    // No pin file should have been created
    await expect(fs.readFile(path.join(dir, "system.pin.json"), "utf8")).rejects.toThrow();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
