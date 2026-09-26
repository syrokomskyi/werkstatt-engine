/*
<MODULE_CONTRACT>
<purpose>RFC-0479: bootstrapping migrator — transforms system.pin.json migratorCursor
from SemVer string to string[] (migrator-id list). This is the first migrator in the
registry and the only one that touches the pin file itself.</purpose>
<non-goals>
  <item>Do not migrate content files — only the pin file cursor format.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0479: initial bootstrapping migrator.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type { Migrator, SternsystemData, MigrationContext } from "./types.ts";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export const RFC_0479_MIGRATOR_ID = "rfc-0479";

async function transformPinCursor(
  data: SternsystemData,
  ctx: MigrationContext,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<SternsystemData> {
  const pinPath = path.join(data.rootPath, "system.pin.json");
  let raw: string;
  try {
    raw = await io.readFile(pinPath);
  } catch {
    ctx.logger.info(`[migrator rfc-0479] no system.pin.json found — nothing to migrate`);
    return data;
  }

  const json = JSON.parse(raw) as Record<string, unknown>;
  const cursor = json.migratorCursor;

  if (Array.isArray(cursor)) {
    ctx.logger.info(`[migrator rfc-0479] migratorCursor already string[] — no-op`);
    return data;
  }

  if (typeof cursor === "string") {
    json.migratorCursor = [RFC_0479_MIGRATOR_ID];
    await io.writeFile(pinPath, JSON.stringify(json, null, 2) + "\n");
    ctx.logger.info(
      `[migrator rfc-0479] transformed migratorCursor from "${cursor}" to ["${RFC_0479_MIGRATOR_ID}"]`,
    );
    return data;
  }

  json.migratorCursor = [RFC_0479_MIGRATOR_ID];
  await io.writeFile(pinPath, JSON.stringify(json, null, 2) + "\n");
  ctx.logger.info(
    `[migrator rfc-0479] migratorCursor was ${cursor === null ? "null" : typeof cursor} — set to ["${RFC_0479_MIGRATOR_ID}"]`,
  );
  return data;
}

export const rfc0479Migrator: Migrator = {
  id: RFC_0479_MIGRATOR_ID,
  fromVersion: "4.5.0",
  toVersion: "4.6.0",
  description: "Bootstrapping migrator: pin migratorCursor string → string[]",
  transform: async (data, ctx) => {
    return transformPinCursor(data, ctx);
  },
};
