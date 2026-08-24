/*
<MODULE_CONTRACT>
<purpose>
RFC-0563: gitmesh.sync command handler. Fetches from all configured remotes,
converges on the latest signed commit using highest committer timestamp,
and advances HEAD via git merge --ff-only. Implements lock file for concurrent
execution prevention, auto-config bootstrap in Phase 1, and signature
verification when verifySignatures is true.
</purpose>
<non-goals>
  <item>Do not implement push operations — gitmesh.sync is pull-only.</item>
  <item>Do not implement peer discovery — that is RFC-0564 (SWIM).</item>
  <item>Do not implement conflict resolution — platform code conflicts are resolved by human review.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — gitmesh.sync handler with convergence algorithm.</item>
  <item>RFC-0563 fix: consolidate duplicated gitLogSignatureStatus call, add diagnostics arrays (RFC-0086), add stale lock detection.</item>
</CHANGE_SUMMARY>
*/

import { open, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";
import type { GitMeshSyncResult } from "./types.ts";
import { loadOrCreateConfig } from "./config.ts";
import {
  gitCommitTimestamp,
  gitFetch,
  gitFsck,
  gitHasUncommittedChanges,
  gitIsAncestor,
  gitLogSignatureStatus,
  gitMergeFfOnly,
  gitRevParseHead,
  gitRevParseRemote,
} from "./git-ops.ts";

const LOCK_FILE = ".git/gitmesh.lock";
const LAST_SYNC_FILE = ".git/gitmesh.last-sync";

const STALE_LOCK_THRESHOLD_MS = 360_000; // 6 minutes — matches git operation timeout

async function acquireLock(workspaceRoot: string): Promise<() => Promise<void>> {
  const lockPath = join(workspaceRoot, LOCK_FILE);
  try {
    const handle = await open(lockPath, "wx");
    return async () => {
      await handle.close();
      await unlink(lockPath).catch(() => {});
    };
  } catch {
    // Check if lock is stale (older than 6 minutes)
    try {
      const lockContent = await readFile(lockPath, "utf8");
      const lockTime = parseInt(lockContent.trim(), 10);
      if (!isNaN(lockTime) && Date.now() - lockTime > STALE_LOCK_THRESHOLD_MS) {
        await unlink(lockPath);
        const handle = await open(lockPath, "wx");
        return async () => {
          await handle.close();
          await unlink(lockPath).catch(() => {});
        };
      }
    } catch {
      // Lock file unreadable or not a number — treat as active
    }
    throw new Error("sync-in-progress: another gitmesh.sync is already running");
  }
}

interface RemoteFetchResult {
  remote: string;
  success: boolean;
  sha: string;
  timestamp: number;
}

export async function runGitMeshSync(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<GitMeshSyncResult>> {
  const { workspaceRoot } = context;
  const releaseLock = await acquireLock(workspaceRoot);
  await writeFile(join(workspaceRoot, LOCK_FILE), String(Date.now()), "utf8").catch(() => {});

  try {
    const config = await loadOrCreateConfig(workspaceRoot);

    if (config.remotes.length === 0) {
      return {
        data: {
          synced: false,
          fromRemote: "",
          commitsReceived: 0,
          currentSha: await gitRevParseHead(workspaceRoot).catch(() => ""),
          signaturesVerified: 0,
          signaturesFailed: 0,
          diagnostics: ["gitmesh.sync: no remotes configured in werkstatt.gitmesh.json"],
        },
        exitCode: 1,
        summary: "[gitmesh.sync] no remotes configured",
        nextSteps: [
          {
            action: "Configure remotes in werkstatt.gitmesh.json and re-run gitmesh.sync",
            kind: "required",
          },
        ],
      };
    }

    // Integrity check
    const fsckOk = await gitFsck(workspaceRoot);
    if (!fsckOk) {
      return {
        data: {
          synced: false,
          fromRemote: "",
          commitsReceived: 0,
          currentSha: "",
          signaturesVerified: 0,
          signaturesFailed: 0,
          diagnostics: [
            "gitmesh.sync: clone corruption detected (git fsck failed) — re-clone from a trusted remote",
          ],
        },
        exitCode: 1,
        summary: "[gitmesh.sync] clone corruption detected (git fsck failed)",
        nextSteps: [
          { action: "Re-clone from a trusted remote, then re-run gitmesh.sync", kind: "required" },
        ],
      };
    }

    // Check for uncommitted changes
    const hasUncommitted = await gitHasUncommittedChanges(workspaceRoot);
    if (hasUncommitted) {
      return {
        data: {
          synced: false,
          fromRemote: "",
          commitsReceived: 0,
          currentSha: await gitRevParseHead(workspaceRoot),
          signaturesVerified: 0,
          signaturesFailed: 0,
          diagnostics: ["gitmesh.sync: uncommitted local changes — commit or stash before sync"],
        },
        exitCode: 1,
        summary: "[gitmesh.sync] uncommitted local changes — commit or stash before sync",
        nextSteps: [
          { action: "Commit or stash local changes, then re-run gitmesh.sync", kind: "required" },
        ],
      };
    }

    // Fetch from all remotes
    const fetchResults: RemoteFetchResult[] = [];
    const warnings: string[] = [];

    for (const remote of config.remotes) {
      try {
        await gitFetch(remote.name, config.trackedBranch, workspaceRoot);
        const sha = await gitRevParseRemote(remote.name, config.trackedBranch, workspaceRoot);
        const timestamp = await gitCommitTimestamp(sha, workspaceRoot);
        fetchResults.push({ remote: remote.name, success: true, sha, timestamp });
      } catch {
        warnings.push(`remote ${remote.name} unreachable`);
        fetchResults.push({ remote: remote.name, success: false, sha: "", timestamp: 0 });
      }
    }

    const successfulFetches = fetchResults.filter((r) => r.success);
    if (successfulFetches.length === 0) {
      return {
        data: {
          synced: false,
          fromRemote: "",
          commitsReceived: 0,
          currentSha: await gitRevParseHead(workspaceRoot),
          signaturesVerified: 0,
          signaturesFailed: 0,
          diagnostics: warnings.map((w) => `gitmesh.sync: ${w}`),
        },
        exitCode: 1,
        summary: `[gitmesh.sync] all remotes unreachable (${warnings.join(", ")})`,
        nextSteps: [
          {
            action: "Check network connectivity and remote availability, then re-run gitmesh.sync",
            kind: "required",
          },
        ],
      };
    }

    // Convergence: highest committer timestamp
    const latest = successfulFetches.reduce((best, current) =>
      current.timestamp > best.timestamp ? current : best,
    );

    const currentHead = await gitRevParseHead(workspaceRoot);

    // Check for non-fast-forward
    const isFastForward = await gitIsAncestor(currentHead, latest.sha, workspaceRoot);
    if (!isFastForward) {
      return {
        data: {
          synced: false,
          fromRemote: latest.remote,
          commitsReceived: 0,
          currentSha: currentHead,
          signaturesVerified: 0,
          signaturesFailed: 0,
          diagnostics: [
            `gitmesh.sync: non-fast-forward detected (force-push on ${latest.remote}?) — manual reset required`,
          ],
        },
        exitCode: 1,
        summary: `[gitmesh.sync] non-fast-forward detected (force-push on ${latest.remote}?) — manual reset required`,
        nextSteps: [
          {
            action: `Manual reset required — force-push detected on ${latest.remote}. Reset HEAD and re-run gitmesh.sync`,
            kind: "required",
          },
        ],
      };
    }

    // Get commits to receive (used for both signature verification and counting)
    const commitsToReceive = await gitLogSignatureStatus(
      `${currentHead}..${latest.sha}`,
      workspaceRoot,
    );

    // Signature verification
    let signaturesVerified = 0;
    let signaturesFailed = 0;

    if (config.verifySignatures) {
      for (const commit of commitsToReceive) {
        if (commit.signatureStatus === "G") {
          signaturesVerified++;
        } else if (commit.signatureStatus === "U" || commit.signatureStatus === "N") {
          // Unsigned — counts as failure in verify mode
          signaturesFailed++;
        } else {
          // B (bad), X (expired), Y (key missing), E (expired key), R (revoked)
          signaturesFailed++;
        }
      }

      if (signaturesFailed > 0) {
        return {
          data: {
            synced: false,
            fromRemote: latest.remote,
            commitsReceived: commitsToReceive.length,
            currentSha: currentHead,
            signaturesVerified,
            signaturesFailed,
            diagnostics: [
              `gitmesh.sync: signature verification failed (${signaturesFailed} invalid) — HEAD not advanced`,
            ],
          },
          exitCode: 1,
          summary: `[gitmesh.sync] signature verification failed (${signaturesFailed} invalid) — HEAD not advanced`,
          nextSteps: [
            {
              action:
                "Review the invalid signatures, remove untrusted commits, then re-run gitmesh.sync",
              kind: "required",
            },
          ],
        };
      }
    }

    // Advance HEAD
    await gitMergeFfOnly(latest.sha, workspaceRoot);

    // Write last-sync timestamp
    const lastSyncPath = join(workspaceRoot, LAST_SYNC_FILE);
    await writeFile(lastSyncPath, new Date().toISOString(), "utf8");

    return {
      data: {
        synced: true,
        fromRemote: latest.remote,
        commitsReceived: commitsToReceive.length,
        currentSha: latest.sha,
        signaturesVerified,
        signaturesFailed,
      },
      exitCode: 0,
      summary:
        `[gitmesh.sync] received ${commitsToReceive.length} commit(s) from ${latest.remote}` +
        (warnings.length > 0 ? `, warnings: ${warnings.join(", ")}` : ""),
    };
  } finally {
    await releaseLock();
  }
}
