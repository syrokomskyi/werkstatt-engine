/*
<MODULE_CONTRACT>
<purpose>RFC-0479: mission.migrate — apply pending migrators from the RFC-id-keyed
registry to the mission workpiece. Reads migratorCursor from the workpiece pin file,
filters the registry for unapplied migrators, applies them in RFC-id order, updates
the cursor, and writes a migration report to evidence/.</purpose>
<non-goals>
  <item>Does not define mission lifecycle — that is RFC-0355.</item>
  <item>Does not materialize the workpiece — that is mission.materialize.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0479: initial mission.migrate command handler.</item>
  <item>RFC-0580: auto-commit werkstatt side-effects (mission.yaml) after writeMissionManifest.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { readMissionManifest, writeMissionManifest, resolveMissionDir } from "./mission-io.ts";
import { acquireLock, releaseLock, commitWerkstattSideEffects } from "../werkstatt/index.ts";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { migratorsToApply } from "../migrators/registry.ts";
import type { SternsystemData, MigrationContext, MigrationViolation } from "../migrators/types.ts";
import { MigrationError } from "../migrators/types.ts";

export interface MissionMigrateData {
  missionId: string;
  systemId: string;
  appliedMigrators: string[];
  skippedMigrators: string[];
  blockedMigrator: string | null;
  blockReason: string | null;
  migratedAt: string;
}

export interface MissionMigrateResult {
  command: "mission.migrate";
  status: "pass" | "blocked" | "fail";
  data?: MissionMigrateData;
  violations: MigrationViolation[];
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

const STERNSYSTEM_DATA_PATHS = ["src/content", "public", "provenance"];

export async function runMissionMigrate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionMigrateData>> {
  const { workspaceRoot, logger } = context;
  const missionId = flagString(input, "mission");
  const reportOnly = flagBool(input, "report-only");

  if (!missionId) throw new Error("[mission.migrate] --mission is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);

  if (manifest.state !== "open") {
    throw new Error(
      `[mission.migrate] mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }

  const operationId = manifest.operationId;
  await acquireLock(
    workspaceRoot,
    `system:${manifest.systemId}`,
    operationId,
    "mission.migrate",
    "agent",
  );
  await acquireLock(workspaceRoot, `mission:${missionId}`, operationId, "mission.migrate", "agent");

  try {
    const missionDir = resolveMissionDir(workspaceRoot, missionId);
    const workpieceDir = path.join(missionDir, "workpiece");

    if (!existsSync(workpieceDir)) {
      throw new Error("[mission.migrate] workpiece not found — run mission.materialize first");
    }

    const pinPath = path.join(workpieceDir, "system.pin.json");
    if (!existsSync(pinPath)) {
      throw new Error("[mission.migrate] system.pin.json not found in workpiece");
    }

    const pinRaw = await fs.readFile(pinPath, "utf8");
    const pin = JSON.parse(pinRaw) as Record<string, unknown>;
    const cursorRaw = pin.migratorCursor;
    const cursor: string[] = Array.isArray(cursorRaw) ? cursorRaw : [];

    const toApply = migratorsToApply(cursor);
    const skippedMigrators = cursor.filter((id) => !toApply.some((m) => m.id === id));

    logger.section("[mission.migrate]");
    logger.info(`  Mission: ${missionId}`);
    logger.info(`  System: ${manifest.systemId}`);
    logger.info(`  Cursor: [${cursor.join(", ")}]`);
    logger.info(`  Pending: ${toApply.length} migrator(s)`);

    if (reportOnly) {
      return {
        data: {
          missionId,
          systemId: manifest.systemId,
          appliedMigrators: [],
          skippedMigrators,
          blockedMigrator: null,
          blockReason: null,
          migratedAt: new Date().toISOString(),
        },
        summary: `[mission.migrate] ${missionId} report-only: ${toApply.length} pending`,
        nextSteps: [
          {
            action: `Apply migrations: pnpm exec werkstatt run mission.migrate --mission ${missionId}`,
            kind: "optional",
          },
        ],
      };
    }

    const dataPaths = STERNSYSTEM_DATA_PATHS.map((p) => path.join(workpieceDir, p));
    const sternsystemData: SternsystemData = {
      rootPath: workpieceDir,
      dataPaths,
    };

    const appliedMigrators: string[] = [];
    let blockedMigrator: string | null = null;
    let blockReason: string | null = null;
    const violations: MigrationViolation[] = [];

    for (const migrator of toApply) {
      const ctx: MigrationContext = {
        systemId: manifest.systemId,
        missionId,
        logger: { info: (msg: string) => logger.info(msg) },
      };

      try {
        await migrator.transform(sternsystemData, ctx);
        appliedMigrators.push(migrator.id);
        logger.info(`  Applied: ${migrator.id}`);
      } catch (err) {
        if (err instanceof MigrationError) {
          blockedMigrator = migrator.id;
          blockReason = err.message;
          violations.push({
            migratorId: migrator.id,
            filePath: err.filePath,
            fieldPath: err.fieldPath,
            reason: err.reason,
          });
          break;
        }
        blockedMigrator = migrator.id;
        blockReason = err instanceof Error ? err.message : String(err);
        violations.push({
          migratorId: migrator.id,
          filePath: "",
          fieldPath: "",
          reason: blockReason,
        });
        break;
      }
    }

    const now = new Date().toISOString();
    const status: "pass" | "blocked" | "fail" = blockedMigrator !== null ? "blocked" : "pass";

    if (appliedMigrators.length > 0) {
      const updatedPinRaw = await fs.readFile(pinPath, "utf8");
      const updatedPin = JSON.parse(updatedPinRaw) as Record<string, unknown>;
      const currentCursor: string[] = Array.isArray(updatedPin.migratorCursor)
        ? updatedPin.migratorCursor
        : [];
      const newCursor = [...new Set([...currentCursor, ...appliedMigrators])];
      updatedPin.migratorCursor = newCursor;
      await fs.writeFile(pinPath, JSON.stringify(updatedPin, null, 2) + "\n", "utf8");
    }

    const evidenceDir = path.join(missionDir, "evidence");
    await fs.mkdir(evidenceDir, { recursive: true });
    const report = {
      schemaVersion: "1.0.0",
      missionId,
      systemId: manifest.systemId,
      appliedMigrators,
      skippedMigrators,
      blockedMigrator,
      blockReason,
      cursorBefore: cursor,
      cursorAfter: Array.isArray(pin.migratorCursor) ? pin.migratorCursor : [],
      migratedAt: now,
    };
    await atomicWriteFile(
      path.join(evidenceDir, "migration-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );

    manifest.migratedAt = now;
    await writeMissionManifest(workspaceRoot, manifest);

    // RFC-0580: auto-commit werkstatt side-effects
    await commitWerkstattSideEffects(
      workspaceRoot,
      [path.join("missions", missionId, "mission.yaml")],
      `werkstatt: mission.migrate ${missionId}`,
    );

    await appendAndCommitBordbuch(
      workspaceRoot,
      manifest.systemId,
      "mission-migrate",
      status === "pass"
        ? `Migration complete: ${appliedMigrators.length} migrator(s) applied`
        : `Migration blocked at ${blockedMigrator}: ${blockReason}`,
      "agent",
      {
        missionId,
        status: status === "pass" ? "done" : "failed",
        metadata: { appliedMigrators, skippedMigrators, blockedMigrator },
      },
      `Bordbuch: mission-migrate ${missionId}`,
    );

    if (status === "blocked") {
      return {
        data: {
          missionId,
          systemId: manifest.systemId,
          appliedMigrators,
          skippedMigrators,
          blockedMigrator,
          blockReason,
          migratedAt: now,
        },
        exitCode: 1,
        summary: `[mission.migrate] ${missionId} blocked at ${blockedMigrator}`,
        nextSteps: [
          {
            action: `Fix the blocking migrator '${blockedMigrator}', then re-run: pnpm exec werkstatt run mission.migrate --mission ${missionId}`,
            kind: "required",
          },
        ],
      };
    }

    logger.success(
      `[mission.migrate] ${missionId} — ${appliedMigrators.length} migrator(s) applied`,
    );

    return {
      data: {
        missionId,
        systemId: manifest.systemId,
        appliedMigrators,
        skippedMigrators,
        blockedMigrator: null,
        blockReason: null,
        migratedAt: now,
      },
      summary: `[mission.migrate] ${missionId} — ${appliedMigrators.length} migrator(s) applied`,
      nextSteps: [
        {
          action: `Validate the mission: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
          kind: "optional",
        },
      ],
    };
  } finally {
    await releaseLock(workspaceRoot, `mission:${missionId}`);
    await releaseLock(workspaceRoot, `system:${manifest.systemId}`);
  }
}
