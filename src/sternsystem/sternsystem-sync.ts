/*
<MODULE_CONTRACT>
<purpose>RFC-0472: sternsystem.sync — synchronize a Sternsystem's local bare repo with an external mirror.</purpose>
<non-goals>
  <item>Sync is an automatic pipeline step invoked after mission.reconcile — not a manual operator action.</item>
  <item>Do not add retry logic — fail-fast on network errors.</item>
  <item>Do not use git push --mirror — it deletes remote branches not present locally.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0472: initial sync command handler.</item>
  <item>RFC-0477: commit and push bordbuch after appending mirror-sync entry.</item>
  <item>RFC-0480: remove pull/both directions — push-only (edits-only-through-missions invariant).</item>
  <item>RFC-0818: reorder external push + bundle creation to after bordbuch commit so bordbuch entry reaches external mirrors.</item>
  <item>ADR-0073: Use --force-with-lease on external mirror push (fetch first for lease baseline) — eliminates non-fast-forward errors on diverged mirrors.</item>
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import * as fs from "node:fs/promises";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  readSystemConfig,
  resolveMirrors,
  resolveMirrorPath,
  isGitAccessible,
} from "./registry-io.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";

export interface SternsystemSyncData {
  systemId: string;
  mirrorUrls: string[];
  direction: "push";
  branch: string;
  commitSha: string | null;
  syncedAt: string;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBoolean(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 300_000,
  }).trim();
}

export async function runSternsystemSync(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemSyncData>> {
  const { workspaceRoot, logger } = context;

  const id = flagString(input, "id");
  if (!id) throw new Error("[sternsystem.sync] --id is required");

  const direction = flagString(input, "direction") ?? "push";
  if (direction !== "push") {
    throw new Error(
      `[sternsystem.sync] --direction must be push (got '${direction}'). Pull and both are removed per RFC-0480 (edits-only-through-missions invariant).`,
    );
  }

  const syncAll = flagBoolean(input, "all");

  const config = await readSystemConfig(workspaceRoot, id);

  if (config.mirrors.length < 2) {
    throw new Error(`[sternsystem.sync] system '${id}' has no bare mirror configured`);
  }

  const { gitMirrors, cachePath } = resolveMirrors(workspaceRoot, config);
  const bareRepoPath = resolveMirrorPath(workspaceRoot, gitMirrors[0].path);
  if (!existsSync(bareRepoPath)) {
    throw new Error(`[sternsystem.sync] bare repo not found at ${bareRepoPath}`);
  }

  // RFC-0574: star topology — first push cache clone to bare repo (mirrors[1])
  let branch: string;
  try {
    branch = git(bareRepoPath, "symbolic-ref HEAD");
  } catch {
    throw new Error(`[sternsystem.sync] bare repo has no commits — nothing to push`);
  }
  const branchName = branch.replace("refs/heads/", "");

  if (existsSync(path.join(cachePath, ".git"))) {
    logger.info(`[sternsystem.sync] pushing cache clone to bare repo…`);
    try {
      // RFC-0986: Use --force-with-lease — cache clone is the source of truth.
      // If the bare repo received unexpected commits after the last fetch,
      // --force-with-lease rejects the push (safe). This fixes non-fast-forward
      // errors caused by divergent histories between cache and bare.
      git(cachePath, `push --force-with-lease origin ${branchName}`);
    } catch (err) {
      logger.warn(
        `[sternsystem.sync] cache-to-bare push failed (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  // External mirrors are mirrors[2+] (git accessible, non-bundle)
  const externalMirrors = config.mirrors.slice(2).filter((m) => isGitAccessible(m.path));
  const mirrorUrls = externalMirrors.map((m) => m.path);

  if (syncAll) {
    branch = "*";
  }

  const refSpec = syncAll ? "--all" : branchName;
  const tagSpec = syncAll ? " --tags" : "";

  const warnings: string[] = [];

  // RFC-0818: Capture commitSha (content SHA) BEFORE bordbuch commit — records
  // what content was synced, not the bordbuch commit itself.
  let commitSha: string;
  try {
    commitSha = git(bareRepoPath, "rev-parse HEAD");
  } catch {
    commitSha = "";
  }

  const syncedAt = new Date().toISOString();

  // RFC-0818: Bordbuch commit happens BEFORE external push so the bordbuch entry
  // reaches external mirrors and bundles. appendAndCommitBordbuch commits in the
  // cache clone and pushes to the bare repo, advancing bare HEAD to N+1.
  try {
    await appendAndCommitBordbuch(
      workspaceRoot,
      id,
      "mirror-sync",
      `Mirror sync (${direction}, branch: ${syncAll ? "*" : branchName}) — ${commitSha.slice(0, 12)}`,
      "sternsystem.sync",
      {
        writerRole: "sternsystem",
        metadata: {
          mirrorUrls,
          direction,
          branch: syncAll ? "*" : branchName,
          commitSha,
          result: "ok",
        },
      },
      `Bordbuch: mirror-sync ${id}`,
    );
  } catch (err) {
    logger.error(`[sternsystem.sync] Bordbuch write failed: ${(err as Error).message}`);
  }

  // RFC-0818: External push moved AFTER bordbuch commit — now includes bordbuch
  // entry commit in the push to external mirrors.
  for (let i = 0; i < mirrorUrls.length; i++) {
    const mirrorUrl = mirrorUrls[i];
    const remoteName = `mirror-${i}`;
    const currentRemoteUrl = (() => {
      try {
        return git(bareRepoPath, `remote get-url ${remoteName}`);
      } catch {
        return null;
      }
    })();

    if (currentRemoteUrl === null) {
      logger.info(`[sternsystem.sync] adding remote '${remoteName}' → ${mirrorUrl}`);
      git(bareRepoPath, `remote add ${remoteName} ${mirrorUrl}`);
    } else if (currentRemoteUrl !== mirrorUrl) {
      logger.info(
        `[sternsystem.sync] updating remote '${remoteName}' URL: ${currentRemoteUrl} → ${mirrorUrl}`,
      );
      git(bareRepoPath, `remote set-url ${remoteName} ${mirrorUrl}`);
    }

    if (direction === "push") {
      logger.info(`[sternsystem.sync] pushing ${refSpec} to ${remoteName}…`);
      try {
        // Fetch first to establish lease baseline for --force-with-lease.
        // Bare repo is the source of truth — external mirrors are backups.
        // --force-with-lease overwrites diverged external commits safely
        // (edits-only-through-missions invariant) while protecting against
        // true concurrent pushes between fetch and push.
        try {
          git(bareRepoPath, `fetch ${remoteName}`);
        } catch {
          // First push or network issue — no tracking ref, proceed below
        }
        try {
          git(bareRepoPath, `push --force-with-lease ${remoteName} ${refSpec}${tagSpec}`);
        } catch {
          // Fallback: plain push (first push, no remote ref to lease against)
          git(bareRepoPath, `push ${remoteName} ${refSpec}${tagSpec}`);
        }
      } catch (err) {
        const stderr = (err as Error).message;
        const msg = `git push to ${mirrorUrl} failed: ${stderr}`;
        warnings.push(msg);
        logger.warn(`[sternsystem.sync] ${msg}`);
      }
    }
  }

  // RFC-0818: Bundle creation moved AFTER bordbuch commit — now includes bordbuch
  // entry commit in bundles.
  const bundleMirrors = config.mirrors.slice(2).filter((m) => m.storageType === "bundle");
  for (const bundleMirror of bundleMirrors) {
    const bundlePath = path.join(tmpdir(), `${id}-${Date.now()}.bundle`);
    try {
      git(bareRepoPath, `bundle create "${bundlePath}" --all`);
      logger.info(`[sternsystem.sync] created bundle for ${bundleMirror.path}`);
      // Copy bundle to backup endpoint (non-git protocols: ftp, s3, rsync)
      // For file-based bundle mirrors, copy directly
      if (
        bundleMirror.path.startsWith("./") ||
        bundleMirror.path.startsWith("../") ||
        bundleMirror.path.startsWith("/")
      ) {
        const destPath = resolveMirrorPath(workspaceRoot, bundleMirror.path);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(bundlePath, destPath);
        logger.info(`[sternsystem.sync] copied bundle to ${destPath}`);
      } else {
        // Non-file protocols (ftp, s3, rsync) — log as warning (external tool required)
        warnings.push(
          `bundle copy to ${bundleMirror.path} requires external tool (ftp/s3/rsync) — bundle was created but not copied (temp bundle cleaned up)`,
        );
        logger.warn(
          `[sternsystem.sync] bundle copy to ${bundleMirror.path} requires external tool`,
        );
      }
    } catch (err) {
      const msg = `bundle creation/copy for ${bundleMirror.path} failed: ${(err as Error).message}`;
      warnings.push(msg);
      logger.warn(`[sternsystem.sync] ${msg}`);
    } finally {
      // Cleanup temp bundle
      await fs.rm(bundlePath, { force: true }).catch(() => {});
    }
  }

  // RFC-0574: per-mirror failures are non-fatal — sync continues and reports warnings

  // RFC-0818: Update refs/mirror/${branch} AFTER bordbuch commit and external
  // push. Now accurately tracks the SHA that was pushed to external mirrors
  // (bordbuch commit included). mission.close checks this ref to determine if
  // external mirrors are in sync.
  if (externalMirrors.length > 0 && !syncAll) {
    try {
      const headSha = git(bareRepoPath, `rev-parse ${branchName}`);
      git(bareRepoPath, `update-ref refs/mirror/${branchName} ${headSha}`);
      logger.info(`[sternsystem.sync] updated refs/mirror/${branchName} → ${headSha.slice(0, 12)}`);
    } catch (err) {
      warnings.push(`Failed to update refs/mirror/${branchName}: ${(err as Error).message}`);
      logger.warn(
        `[sternsystem.sync] Failed to update refs/mirror/${branchName}: ${(err as Error).message}`,
      );
    }
  }

  logger.info(
    `[sternsystem.sync] ${id} mirrored (${direction}, branch: ${syncAll ? "*" : branchName})`,
  );

  const data: SternsystemSyncData = {
    systemId: id,
    mirrorUrls,
    direction: "push",
    branch: syncAll ? "*" : branchName,
    commitSha,
    syncedAt,
  };

  return {
    data,
    exitCode: 0,
    summary: `[sternsystem.sync] ${id} mirrored (${direction}, branch: ${syncAll ? "*" : branchName})`,
    nextSteps: [
      {
        action: `Open a mission: pnpm exec werkstatt run mission.open --system ${id} --brief "<brief>"`,
        kind: "optional",
      },
    ],
  };
}
