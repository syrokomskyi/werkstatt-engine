/*
<MODULE_CONTRACT>
<purpose>RFC-0221: `handoff.validate` — pre-flight integrity check of a bundle without absorbing.</purpose>
<non-goals>
  <item>Do not migrate, regenerate, or write anything.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial bundle validator.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { hashFile, readLock, readManifest } from "./bundle-io.ts";

export interface HandoffValidateData {
  bundleDir: string;
  app: string;
  entriesChecked: number;
  problems: string[];
}

function resolveBundleDir(input: KernelCommandInput, workspaceRoot: string): string {
  const flag = input.flags["bundle"];
  const raw = typeof flag === "string" ? flag : undefined;
  if (!raw) {
    throw new Error("[handoff.validate] requires --bundle <path>");
  }
  return path.resolve(workspaceRoot, raw);
}

export async function runHandoffValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<HandoffValidateData>> {
  const { workspaceRoot, logger } = context;
  const bundleDir = resolveBundleDir(input, workspaceRoot);

  const lock = await readLock(bundleDir);
  const manifest = await readManifest(bundleDir);
  const problems: string[] = [];

  if (lock.app !== manifest.app) {
    problems.push(`lock.app (${lock.app}) != manifest.app (${manifest.app})`);
  }

  for (const entry of manifest.entries) {
    const abs = path.join(bundleDir, entry.path);
    try {
      const actual = await hashFile(abs);
      if (actual !== entry.hash) {
        problems.push(`hash mismatch: ${entry.path} (${entry.kind})`);
      }
    } catch {
      problems.push(`missing file: ${entry.path}`);
    }
  }

  logger.section("[handoff.validate]");
  logger.info(`Bundle: ${bundleDir}`);
  logger.info(
    `App: ${lock.app} | ecosystem ${lock.ecosystem.version} | ${manifest.entries.length} entries`,
  );

  const data: HandoffValidateData = {
    bundleDir,
    app: lock.app,
    entriesChecked: manifest.entries.length,
    problems,
  };

  if (problems.length > 0) {
    for (const p of problems) logger.error(`[handoff.validate] ${p}`);
    return {
      data,
      exitCode: 1,
      summary: `[handoff.validate] ${problems.length} integrity problem(s)`,
      nextSteps: [
        {
          action: `Fix the ${problems.length} integrity problem(s) above, then re-run: pnpm exec werkstatt run handoff.validate --bundle <bundle-dir>`,
          kind: "required",
        },
      ],
    };
  }

  logger.success("[handoff.validate] bundle integrity OK");
  return { data, summary: `[handoff.validate] OK — ${manifest.entries.length} entries verified` };
}
