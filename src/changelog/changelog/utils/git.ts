/* <MODULE_CONTRACT>
<purpose>Facilitates interaction with Git to collect commit data and extract relevant information for changelog generation.</purpose>
<non-goals>
  <item>Do not handle Git configuration or repository initialization.</item>
  <item>Do not perform network operations or remote repository interactions.</item>
  <item>Do not parse raw content here; focus on structured commit data.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY> */

import { simpleGit } from "simple-git";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RawCommit } from "../types.ts";
import type { ChangelogCtx } from "../context.ts";

const CONVENTIONAL_REGEX = /^(feat|fix|refactor|docs|perf|test|build|ci|chore|style)(\(.+\))?(!)?:/;

// START_BLOCK_COLLECT
/**
 * Collects commits for the app directory between two ISO date strings.
 * Uses `git log -- apps/main/` to scope to this app only.
 * [CL-GIT][collectCommits][STARTED] appRelPath={ctx.appRelPath}
 */
export async function collectCommits(
  from: string,
  to: string,
  ctx: ChangelogCtx,
): Promise<RawCommit[]> {
  const git = simpleGit(ctx.workspaceRoot);

  const logArgs = [
    "log",
    `--after=${from}`,
    `--before=${to}`,
    "--name-status",
    "--format=%H|||%an|||%aI|||%s|||%b|||END_BODY",
    ...(ctx.includeMergeCommits ? [] : ["--no-merges"]),
    "--",
    ctx.appRelPath + "/",
  ];

  const rawLog = await git.raw(logArgs);
  const parsed = parseGitLog(rawLog);

  const commits = await Promise.all(
    parsed.map(async (entry) => {
      const treeHash = (await git.raw(["rev-parse", `${entry.hash}^{tree}`])).trim();
      const diffStat = (await git.raw(["show", "--stat", "--format=", entry.hash]))
        .split("\n")
        .slice(0, 15)
        .join("\n");

      return {
        hash: entry.hash,
        treeHash,
        author: entry.author,
        date: new Date(entry.date),
        message: entry.message,
        body: entry.body || undefined,
        files: entry.files,
        diffSummary: diffStat,
        isConventional: CONVENTIONAL_REGEX.test(entry.message),
        conventionalType: extractConventionalType(entry.message),
      } satisfies RawCommit;
    }),
  );

  return commits;
}
// END_BLOCK_COLLECT

// START_BLOCK_HELPERS
function parseGitLog(raw: string) {
  const entries: Array<{
    hash: string;
    author: string;
    date: string;
    message: string;
    body: string;
    files: string[];
  }> = [];
  const blocks = raw.split(/(?=^[0-9a-f]{40}\|\|\|)/m).filter(Boolean);

  for (const block of blocks) {
    const headerEnd = block.indexOf("\n");
    if (headerEnd === -1) continue;
    const [hash = "", author = "", date = "", message = ""] = block
      .slice(0, headerEnd)
      .split("|||");
    const rest = block.slice(headerEnd + 1);
    const bodyEnd = rest.indexOf("END_BODY");
    const body = bodyEnd !== -1 ? rest.slice(0, bodyEnd).trim() : "";
    const fileSection = bodyEnd !== -1 ? rest.slice(bodyEnd + 8) : rest;
    const files = fileSection
      .split("\n")
      .filter((l) => /^[AMDRT]\s+/.test(l))
      .map((l) => l.replace(/^[AMDRT]\s+/, "").trim())
      .filter(Boolean);
    entries.push({
      hash: hash.trim(),
      author: author.trim(),
      date: date.trim(),
      message: message.trim(),
      body,
      files,
    });
  }
  return entries;
}

function extractConventionalType(message: string): string | undefined {
  return CONVENTIONAL_REGEX.exec(message)?.[1];
}

export async function getLatestCommitHash(workspaceRoot: string): Promise<string> {
  return (await simpleGit(workspaceRoot).raw(["rev-parse", "HEAD"])).trim();
}

export async function getAppVersion(appDir: string): Promise<string> {
  const raw = await readFile(join(appDir, "package.json"), "utf-8");
  return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
}
// END_BLOCK_HELPERS
