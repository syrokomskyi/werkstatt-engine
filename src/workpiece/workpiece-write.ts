/*
<MODULE_CONTRACT>
<purpose>
RFC-0555: workpiece.write — write a file to a mission workpiece with DNA-22
path validation. Content is read from stdin (not a CLI flag) to avoid shell
argument length limits. Does NOT auto-commit — LLMs must call
mission.git.commit separately to group multiple writes into one commit.
</purpose>
<non-goals>
  <item>Does not auto-commit — mission.git.commit is the atomicity boundary.</item>
  <item>Does not handle system.md partial field edits — future enhancement.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0555: initial workpiece.write command handler.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { readMissionManifest, resolveMissionDir } from "../mission/mission-io.ts";
import { isClientEditable } from "./dna-22-checker.ts";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export interface WorkpieceWriteResult {
  path: string;
  bytesWritten: number;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runWorkpieceWrite(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<WorkpieceWriteResult>> {
  const missionId = flagString(input, "mission");
  const relativePath = flagString(input, "path");

  if (!missionId) {
    throw new Error("[workpiece.write] --mission flag is required");
  }
  if (!relativePath) {
    throw new Error("[workpiece.write] --path flag is required");
  }

  const { workspaceRoot, logger } = context;

  const manifestPath = path.join(
    await resolveMissionDir(workspaceRoot, missionId, context.io),
    "mission.yaml",
  );
  if (!(await context.io.exists(manifestPath))) {
    throw new Error(`[workpiece.write] Mission '${missionId}' is not open or does not exist`);
  }

  const manifest = await readMissionManifest(workspaceRoot, missionId);
  if (manifest.state !== "open") {
    throw new Error(
      `[workpiece.write] Mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }

  const workpieceDir = path.join(
    await resolveMissionDir(workspaceRoot, missionId, context.io),
    "workpiece",
  );
  if (!(await context.io.exists(workpieceDir))) {
    throw new Error(
      `[workpiece.write] Workpiece for mission '${missionId}' not found. Run mission.materialize first.`,
    );
  }

  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const resolvedPath = path.resolve(workpieceDir, normalizedPath);
  if (!resolvedPath.startsWith(workpieceDir)) {
    throw new Error("[workpiece.write] Path traversal detected");
  }

  const allowed = await isClientEditable(workpieceDir, normalizedPath);
  if (!allowed) {
    throw new Error(`Path '${normalizedPath}' is outside client-editable surface (DNA-22)`);
  }

  const content = await readStdin();

  const parentDir = path.dirname(resolvedPath);
  if (!(await context.io.exists(parentDir))) {
    await context.io.mkdir(parentDir);
  }

  await context.io.writeFile(resolvedPath, content);
  const bytesWritten = Buffer.byteLength(content, "utf8");
  logger.info(`[workpiece.write] ${missionId}: wrote ${normalizedPath} (${bytesWritten} bytes)`);

  return {
    data: { path: normalizedPath, bytesWritten },
    exitCode: 0,
    summary: "[workpiece.write] Done",
  };
}
