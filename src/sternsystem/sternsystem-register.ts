/*
<MODULE_CONTRACT>
<purpose>RFC-0354 §7.1 + RFC-0532: sternsystem.register — add a new Sternsystem to the fleet
registry, create pin, content stubs, open first mission, and trigger materialization.
With --amend: update pin and open amend mission without creating a new registry entry.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
  <item>Do not reimplement pin, mission.open, or mission.materialize logic — delegate to existing commands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0354: initial register command handler.</item>
  <item>RFC-0532: extend with pin creation, content stubs, mission.open, mission.materialize, --amend/--amend-id flags, and atomic rollback.</item>
  <item>RFC-0561: add --owner flag for VC subject id (did:web) on new registration and amend backfill.</item>
  <item>RFC-0902: reject TLD-suffixed IDs before writing any files.</item>
</CHANGE_SUMMARY>
*/

import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
  KernelFlagValue,
} from "@warpgogol/werkstatt-engine/kernel";
import { StarCatalog, type StarName } from "@warpgogol/werkstatt-shared/ontology/cosmic";
import { parseBriefFrontmatter } from "@warpgogol/werkstatt-shared/onboarding";
import {
  discoverSystems,
  readSystemConfig,
  writeSystemConfig,
  hasAppsCollision,
  resolveMirrorPath,
  resolveCacheClonePath,
} from "./registry-io.ts";
import { runSternsystemPin } from "./sternsystem-pin.ts";
import { runMissionOpen } from "../mission/mission-open.ts";
import { runMissionMaterialize } from "../mission/mission-materialize.ts";
import { runMissionAbort } from "../mission/mission-abort.ts";
import { hasTldSuffix } from "../schemas/naming-policy.ts";

export interface SternsystemRegisterData {
  command: "sternsystem.register";
  system: string;
  status: "pass" | "fail";
  registryEntry?: {
    id: string;
    cosmicStar: string;
    status: "registered" | "active";
    registeredAt: string;
  };
  pinPath?: string;
  firstMissionId?: string;
  diagnostics: string[];
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return typeof v === "boolean" ? v : false;
}

function flagNumber(input: KernelCommandInput, key: string): number | undefined {
  const v = input.flags[key];
  return typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined;
}

function makeInput(flags: Record<string, KernelFlagValue>): KernelCommandInput {
  return { flags, argv: [] };
}

export async function createContentStub(
  workspaceRoot: string,
  id: string,
  systemDir: string,
): Promise<void> {
  const briefPath = join(workspaceRoot, "onboarding", id, ".input", "00-brief.md");
  if (!existsSync(briefPath)) return;

  const raw = await readFile(briefPath, "utf8");
  let brief: ReturnType<typeof parseBriefFrontmatter>;
  try {
    brief = parseBriefFrontmatter(raw);
  } catch {
    return;
  }

  const contentDir = join(systemDir, "content");
  await mkdir(contentDir, { recursive: true });

  const supported = brief.i18n.supported.map((l) => `  - ${l}`).join("\n");
  const systemMd = `---
identity:
  domain: ${brief.client.domain}
i18n:
  default: ${brief.i18n.default}
  supported:
${supported}
legalJurisdiction: ${brief.legalJurisdiction}
---
`;
  await writeFile(join(contentDir, "system.md"), systemMd, "utf8");
}

async function rollbackConfig(workspaceRoot: string, id: string): Promise<void> {
  const cacheClone = resolveCacheClonePath(workspaceRoot, id);
  const configPath = join(cacheClone, "system-config.yaml");
  if (existsSync(configPath)) {
    await rm(configPath, { force: true });
  }
}

async function rollbackPin(systemDir: string): Promise<void> {
  const pinPath = join(systemDir, "system.pin.json");
  if (existsSync(pinPath)) {
    await rm(pinPath, { force: true });
  }
}

async function rollbackContent(systemDir: string): Promise<void> {
  const contentPath = join(systemDir, "content");
  if (existsSync(contentPath)) {
    await rm(contentPath, { recursive: true, force: true });
  }
}

async function rollbackSystemDirIfEmpty(systemDir: string): Promise<void> {
  if (!existsSync(systemDir)) return;
  const gitDir = join(systemDir, ".git");
  if (existsSync(gitDir)) return;
  await rm(systemDir, { recursive: true, force: true });
}

export async function runSternsystemRegister(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemRegisterData>> {
  const { workspaceRoot, logger } = context;

  const id = flagString(input, "id");
  const cosmicStar = flagString(input, "cosmicStar");
  const mirrorsFlag = flagString(input, "mirrors");
  const platform = flagString(input, "platform");
  const owner = flagString(input, "owner");
  const isAmend = flagBool(input, "amend");
  const amendId = flagNumber(input, "amend-id");

  if (!id) throw new Error("[sternsystem.register] requires --id <kebab-case-id>");

  // RFC-0902: Reject TLD-suffixed IDs before any file operations.
  if (hasTldSuffix(id)) {
    throw new Error(
      `[sternsystem.register] id '${id}' ends in a TLD suffix — use the business ID without domain TLD (e.g. 'warpgogol' not 'warpgogol-com')`,
    );
  }

  const diagnostics: string[] = [];

  if (isAmend) {
    const _config = await readSystemConfig(workspaceRoot, id);

    if (owner) {
      // owner field not in systemConfigSchema — would need schema extension
      // For now, log warning that owner update is not supported in convention-based config
      logger.info(`[sternsystem.register] --amend: owner update not yet supported for '${id}'`);
    }

    const pinInput: Record<string, KernelFlagValue> = { id };
    if (platform) pinInput.platform = platform;
    const pinResult = await runSternsystemPin(makeInput(pinInput), context);
    const pinPath = pinResult.data!.pinPath;

    const brief = amendId ? `Amend ${amendId} for ${id}` : `Amend for ${id}`;
    const missionResult = await runMissionOpen(makeInput({ system: id, brief }), context);
    const missionId = missionResult.data!.missionId;

    try {
      await runMissionMaterialize(makeInput({ mission: missionId }), context);
    } catch (materializeError) {
      logger.info(
        `[sternsystem.register] mission.materialize failed during amend — aborting mission ${missionId}`,
      );
      try {
        await runMissionAbort(
          makeInput({
            mission: missionId,
            reason: "sternsystem.register amend: materialize failed",
          }),
          context,
        );
      } catch (abortError) {
        diagnostics.push(
          `mission.abort also failed: ${abortError instanceof Error ? abortError.message : String(abortError)}`,
        );
      }
      throw materializeError;
    }

    return {
      data: {
        command: "sternsystem.register",
        system: id,
        status: "pass",
        pinPath,
        firstMissionId: missionId,
        diagnostics,
      },
      summary: `[sternsystem.register] amended '${id}' — mission ${missionId} opened and materialized`,
      nextSteps: [
        {
          action: `Validate the system: pnpm exec werkstatt run sternsystem.validate --id ${id}`,
          kind: "optional",
        },
      ],
    };
  }

  if (!cosmicStar) throw new Error("[sternsystem.register] requires --cosmicStar <StarName>");
  if (!mirrorsFlag)
    throw new Error(
      "[sternsystem.register] requires --mirrors <comma-separated-paths> (first is cache, second is bare, rest are external)",
    );

  if (!(StarCatalog as readonly string[]).includes(cosmicStar)) {
    throw new Error(`[sternsystem.register] cosmicStar '${cosmicStar}' is not in StarCatalog`);
  }

  if (hasAppsCollision(workspaceRoot, id)) {
    throw new Error(
      `[sternsystem.register] id '${id}' matches existing apps/${id}/ — extract first`,
    );
  }

  // Check for existing system via discovery
  const { systems: existingSystems } = await discoverSystems(workspaceRoot);

  if (existingSystems.some((s) => s.id === id)) {
    throw new Error(`[sternsystem.register] id '${id}' already exists in ../systems-cache/`);
  }

  const starOwner = existingSystems.find(
    (s) => s.cosmicStar === cosmicStar && s.status !== "archived",
  );
  if (starOwner) {
    throw new Error(
      `[sternsystem.register] cosmicStar '${cosmicStar}' is already used by '${starOwner.id}' (status: ${starOwner.status})`,
    );
  }

  const pinnedPlatform = platform ?? existingSystems[0]?.pinnedPlatform ?? "0.0.0";

  type ValidStorageType = "non-bare" | "bare" | "bundle";
  const mirrors = mirrorsFlag.split(",").map((entry) => {
    const m = entry.match(/^(.+):(non-bare|bare|bundle)$/);
    if (m) {
      return { path: m[1], storageType: m[2] as ValidStorageType };
    }
    return { path: entry, storageType: "non-bare" as const };
  });

  const newConfig = {
    schemaVersion: "1.0.0" as const,
    id,
    cosmicStar: cosmicStar as StarName,
    mirrors,
    pinnedPlatform,
    status: "registered" as const,
    registeredAt: new Date().toISOString(),
    notes: "",
  };

  const systemDir = resolveMirrorPath(workspaceRoot, mirrors[0].path);
  await mkdir(systemDir, { recursive: true });
  await writeSystemConfig(workspaceRoot, id, newConfig);

  let pinCreated = false;
  let contentCreated = false;
  let missionOpened = false;
  let missionId: string | undefined;

  try {
    const pinInput: Record<string, KernelFlagValue> = { id };
    if (platform) pinInput.platform = platform;
    const pinResult = await runSternsystemPin(makeInput(pinInput), context);
    const pinPath = pinResult.data!.pinPath;
    pinCreated = true;

    await createContentStub(workspaceRoot, id, systemDir);
    contentCreated = true;

    const missionResult = await runMissionOpen(
      makeInput({ system: id, brief: `Initial onboarding for ${id}` }),
      context,
    );
    missionId = missionResult.data!.missionId;
    missionOpened = true;

    try {
      await runMissionMaterialize(makeInput({ mission: missionId }), context);
    } catch (materializeError) {
      logger.info(
        `[sternsystem.register] mission.materialize failed — rolling back mission ${missionId}`,
      );
      try {
        await runMissionAbort(
          makeInput({ mission: missionId, reason: "sternsystem.register: materialize failed" }),
          context,
        );
      } catch (abortError) {
        diagnostics.push(
          `mission.abort also failed: ${abortError instanceof Error ? abortError.message : String(abortError)}`,
        );
      }
      throw materializeError;
    }

    // RFC-0574: mirror hook removed — star topology uses explicit sternsystem.sync
    void workspaceRoot;

    logger.success(
      `[sternsystem.register] registered '${id}' (cosmicStar: ${cosmicStar}) — mission ${missionId} opened and materialized`,
    );

    return {
      data: {
        command: "sternsystem.register",
        system: id,
        status: "pass",
        registryEntry: {
          id,
          cosmicStar,
          status: "active",
          registeredAt: newConfig.registeredAt,
        },
        pinPath,
        firstMissionId: missionId,
        diagnostics,
      },
      summary: `[sternsystem.register] ${id} registered with cosmicStar ${cosmicStar} — mission ${missionId} materialized`,
      nextSteps: [
        {
          action: `Validate the system: pnpm exec werkstatt run sternsystem.validate --id ${id}`,
          kind: "optional",
        },
      ],
    };
  } catch (error) {
    logger.info(
      `[sternsystem.register] rolling back due to error: ${error instanceof Error ? error.message : String(error)}`,
    );

    if (missionOpened && missionId) {
      try {
        await runMissionAbort(
          makeInput({ mission: missionId, reason: "sternsystem.register rollback" }),
          context,
        );
      } catch (abortError) {
        diagnostics.push(
          `mission.abort during rollback failed: ${abortError instanceof Error ? abortError.message : String(abortError)}`,
        );
      }
    }
    if (contentCreated) {
      await rollbackContent(systemDir);
    }
    if (pinCreated) {
      await rollbackPin(systemDir);
    }
    await rollbackConfig(workspaceRoot, id);
    await rollbackSystemDirIfEmpty(systemDir);

    diagnostics.push(
      `sternsystem.register failed: ${error instanceof Error ? error.message : String(error)}`,
    );

    return {
      data: {
        command: "sternsystem.register",
        system: id,
        status: "fail",
        diagnostics,
      },
      exitCode: 1,
      summary: `[sternsystem.register] ${id} failed and rolled back: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
