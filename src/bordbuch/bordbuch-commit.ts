/*
<MODULE_CONTRACT>
  <purpose>RFC-0626: bordbuch.commit — auto-commit dirty bordbuch projection files in the cache clone after bordbuch.generate.</purpose>
  <non-goals>
    <item>Does not generate bordbuch projections — use bordbuch.generate for that.</item>
    <item>Does not commit non-bordbuch files — only stages the three bordbuch projection paths.</item>
    <item>Does not acquire locks — pipeline runs sequentially and bordbuch.generate has already released locks by the time bordbuch.commit runs.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0626: initial bordbuch.commit command handler.</item>
  <item>RFC-0646: replace all gitExec calls with gitExecWithRetry for transient-failure resilience.</item>
  <item>RFC-0702: wrap all gitExecWithRetry calls in try/catch — git failures return error result instead of throwing; add error field to BordbuchCommitResult; add logger.warn in runBordbuchCommit on git failure.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { gitExecWithRetry, type RetryOptions } from "../werkstatt/git-exec.ts";
import { resolveCacheClonePath } from "../sternsystem/registry-io.ts";

const BORDBUCH_PROJECTION_PATHS = [
  "bordbuch/events.ndjson",
  "bordbuch/status.generated.yaml",
  "public/.well-known/bordbuch.json",
  "public/.well-known/bordbuch/index.html",
];

const BORDBUCH_RETRY_OPTIONS: RetryOptions = {
  backoffMs: [12_000, 60_000],
};

export interface BordbuchCommitResult {
  committed: boolean;
  commitSha: string | null;
  systemId: string;
  filesCommitted: string[];
  error?: string;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function commitBordbuchProjections(
  workspaceRoot: string,
  systemId: string,
): Promise<BordbuchCommitResult> {
  let cachePath: string;
  try {
    cachePath = await resolveCacheClonePath(workspaceRoot, systemId);
  } catch {
    return { committed: false, commitSha: null, systemId, filesCommitted: [] };
  }

  try {
    const status = await gitExecWithRetry(cachePath, "status --porcelain", BORDBUCH_RETRY_OPTIONS, {
      allowNonZero: true,
    });
    if (!status) {
      return { committed: false, commitSha: null, systemId, filesCommitted: [] };
    }

    const dirtyFiles = status
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim());

    const bordbuchDirty = dirtyFiles.filter((f) =>
      BORDBUCH_PROJECTION_PATHS.some((p) => f === p || f.startsWith(p)),
    );

    if (bordbuchDirty.length === 0) {
      return { committed: false, commitSha: null, systemId, filesCommitted: [] };
    }

    const addArgs = bordbuchDirty.map((f) => `"${f}"`).join(" ");
    await gitExecWithRetry(cachePath, `add -- ${addArgs}`, BORDBUCH_RETRY_OPTIONS);

    await gitExecWithRetry(
      cachePath,
      'commit -m "chore: bordbuch projections from build.prepare"',
      BORDBUCH_RETRY_OPTIONS,
    );

    const sha = await gitExecWithRetry(cachePath, "rev-parse HEAD", BORDBUCH_RETRY_OPTIONS);

    return { committed: true, commitSha: sha, systemId, filesCommitted: bordbuchDirty };
  } catch (err) {
    return {
      committed: false,
      commitSha: null,
      systemId,
      filesCommitted: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runBordbuchCommit(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<BordbuchCommitResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;

  if (!systemId) {
    return {
      summary: "[bordbuch.commit] no system id — skipping",
    };
  }

  const result = await commitBordbuchProjections(workspaceRoot, systemId);

  if (result.committed) {
    logger.success(
      `[bordbuch.commit] committed ${result.filesCommitted.length} bordbuch projection files for ${systemId}`,
    );
    return {
      data: result,
      summary: `[bordbuch.commit] committed ${result.filesCommitted.length} bordbuch projection files for ${systemId}`,
      nextSteps: [
        {
          action: `Push to remote: pnpm exec werkstatt run sternsystem.sync --id ${systemId}`,
          kind: "optional",
        },
      ],
    };
  }

  if (result.error) {
    logger.warn(`[bordbuch.commit] git operation failed for ${systemId}: ${result.error}`);
    return {
      data: result,
      summary: `[bordbuch.commit] git operation failed for ${systemId}: ${result.error}`,
      nextSteps: [
        {
          action: `Check git status and resolve the conflict, then re-run: pnpm exec werkstatt run bordbuch.commit --site ${systemId}`,
          kind: "required",
        },
      ],
    };
  }

  return {
    data: result,
    summary: `[bordbuch.commit] no dirty bordbuch files for ${systemId}`,
  };
}
