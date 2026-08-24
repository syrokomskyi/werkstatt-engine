/*
<MODULE_CONTRACT>
  <purpose>Facilitates the construction and management of changelog contexts for applications within the workspace.</purpose>
      <non-goals>
    <item>Do not handle the actual writing of changelog files.</item>
    <item>Do not manage application lifecycle or orchestration.</item>
    <item>Do not parse raw content from changelog files.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Backfills architectural documentation for changelog context management utilities.</item>
</CHANGE_SUMMARY>
*/

import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

const _packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// START_BLOCK_CTX
export interface ChangelogCtx {
  /** Absolute path to the app directory (e.g. /repo/apps/main). */
  appDir: string;
  /** Short app name (e.g. 'main', 'nicaragua-projekt'). */
  appName: string;
  /** App path relative to workspace root (e.g. 'apps/main'). Used to scope git log. */
  appRelPath: string;
  /** Absolute workspace root. */
  workspaceRoot: string;
  /** Skip all file writes. */
  dryRun: boolean;
  /** Run even when today is not a configured release day. */
  force: boolean;
  // LLM
  llmProvider: "openai" | "anthropic";
  llmModel: string;
  llmApiKey: string;
  llmTemperature: number;
  llmMaxTokens: number;
  maxParallelRequests: number;
  // Versioning
  lockMajor: boolean;
  confidenceThreshold: number;
  // Git
  includeMergeCommits: boolean;
  // Release schedule
  releaseMode: "weekly" | "monthly";
  releaseDay: number;
  timezone: string;
  // Derived paths
  /** apps/{name}/CHANGELOG.md */
  indexFile: string;
  /** apps/{name}/changelogs/ */
  detailsDir: string;
  /** apps/{name}/.changelog-system/state.json */
  statePath: string;
  /** {workspaceRoot}/.changelog-system/cache/ (shared across apps) */
  cacheDir: string;
  /**
   * GitHub repo base URL, e.g. "https://github.com/org/repo".
   * Used to build clickable issue/PR links in changelogs.
   * Optional — links are omitted when absent.
   */
  repoUrl: string | undefined;
  /** {workspaceRoot}/prompts/ */
  promptsDir: string;
}
// END_BLOCK_CTX

// START_BLOCK_HELPERS
/**
 * Checks for a boolean flag in input.flags.
 */
export function hasFlag(input: KernelCommandInput, name: string): boolean {
  if (input.flags[name] === true) return true;
  return false;
}

/**
 * Reads a string-valued flag from input.flags.
 */
export function readFlag(input: KernelCommandInput, name: string): string | undefined {
  const fromFlags = input.flags[name];
  if (typeof fromFlags === "string") return fromFlags;
  return undefined;
}
// END_BLOCK_HELPERS

// START_BLOCK_BUILD
/**
 * Builds a ChangelogCtx from KernelRuntimeContext and command flags.
 * LLM credentials come from environment variables only.
 */
export function buildChangelogCtx(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): ChangelogCtx {
  const site = context.site;
  if (!site) throw new Error("changelog commands require site-scoped context (--site <name>)");

  const appDir = site.directory;
  const workspaceRoot = context.workspaceRoot;

  const rawProvider = readFlag(input, "provider") ?? process.env["LLM_PROVIDER"] ?? "openai";
  const llmProvider = rawProvider === "anthropic" ? "anthropic" : "openai";

  return {
    appDir,
    appName: site.name,
    appRelPath: relative(workspaceRoot, appDir).replace(/\\/g, "/"),
    workspaceRoot,
    dryRun: context.dryRun || hasFlag(input, "dry-run"),
    force: hasFlag(input, "force"),
    llmProvider,
    llmModel: readFlag(input, "model") ?? process.env["LLM_MODEL"] ?? "gpt-4o",
    llmApiKey: process.env["LLM_API_KEY"] ?? "",
    llmTemperature: 0,
    llmMaxTokens: 2000,
    maxParallelRequests: 5,
    lockMajor: true,
    confidenceThreshold: 0.85,
    includeMergeCommits: false,
    releaseMode: (readFlag(input, "mode") ?? "weekly") === "monthly" ? "monthly" : "weekly",
    releaseDay: Number(readFlag(input, "day") ?? 1),
    timezone: readFlag(input, "tz") ?? "Europe/Berlin",
    indexFile: join(appDir, "CHANGELOG.md"),
    detailsDir: join(appDir, "changelogs"),
    statePath: join(appDir, ".changelog-system", "state.json"),
    cacheDir: join(workspaceRoot, ".changelog-system", "cache"),
    repoUrl:
      process.env["REPO_URL"] ??
      (process.env["GITHUB_SERVER_URL"] && process.env["GITHUB_REPOSITORY"]
        ? `${process.env["GITHUB_SERVER_URL"]}/${process.env["GITHUB_REPOSITORY"]}`
        : undefined),
    promptsDir: join(_packageRoot, "prompts"),
  };
}
// END_BLOCK_BUILD
