/*
<MODULE_CONTRACT>
<purpose>Shared git command executor for werkstatt and bordbuch modules. Extracted from bordbuch-io.ts (RFC-0580) to avoid cross-module dependency. Provides gitExec (synchronous) and gitExecWithRetry (async with transient-failure retry, RFC-0646).</purpose>
<non-goals>
  <item>Does not define git workflow logic — that lives in callers.</item>
  <item>Does not retry non-transient errors — only timeout and lock-file errors are retried (RFC-0646).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0580: extract gitExec from bordbuch-io.ts into shared utility with allowNonZero option.</item>
  <item>RFC-0646: add gitExecWithRetry companion with RetryOptions for transient-failure resilience.</item>
  <item>RFC-0794: add optional env parameter to gitExec and gitExecWithRetry for passing environment variables (e.g. ECOSYSTEM_COMMIT=1) to git commands.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
</CHANGE_SUMMARY>
*/

import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export async function gitExec(
  cwd: string,
  args: string,
  options?: { allowNonZero?: boolean; env?: NodeJS.ProcessEnv },
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string> {
  const env = options?.env
    ? (Object.fromEntries(Object.entries(options.env).filter(([, v]) => v !== undefined)) as Record<
        string,
        string
      >)
    : undefined;
  const result = await io.exec("sh", ["-c", `git ${args}`], {
    cwd,
    timeoutMs: 30_000,
    env,
  });
  if (result.exitCode !== 0) {
    if (options?.allowNonZero) {
      return "";
    }
    throw new Error(`git ${args} failed (${result.exitCode}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

export interface RetryOptions {
  backoffMs: number[];
}

function isTransientError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const message = typeof e.message === "string" ? e.message : "";
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.status === "number" ? e.status : null;

  if (code === "ETIMEDOUT") return true;
  if (message.includes("index.lock")) return true;
  if (message.includes("Another git process seems to be running")) return true;
  if (status === 128 && message.includes("lock")) return true;
  if (message.includes("timeout") || message.includes("timed out")) return true;

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function gitExecWithRetry(
  cwd: string,
  args: string,
  retryOptions: RetryOptions,
  options?: { allowNonZero?: boolean; env?: NodeJS.ProcessEnv },
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryOptions.backoffMs.length; attempt++) {
    try {
      return await gitExec(cwd, args, options, io);
    } catch (err) {
      lastError = err;
      if (!isTransientError(err)) throw err;
      if (attempt < retryOptions.backoffMs.length) {
        await sleep(retryOptions.backoffMs[attempt]);
      }
    }
  }
  throw lastError;
}
