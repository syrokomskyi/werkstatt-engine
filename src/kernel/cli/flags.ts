/*
<MODULE_CONTRACT>
<purpose>shared CLI flag parsing — common flag consumption, help/json token detection, and usage text for the werkstatt CLI surface.</purpose>
<non-goals>
  <item>Do not execute commands or touch the registry — pure argv parsing only.</item>
  <item>Do not parse command-declared flags — that is resolveCommandFlags' job in runtime/argv.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>consumeCommonFlags is the single parser for CLI-envelope flags; batch entries re-parse through it so per-entry flags override globals.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1309: extracted from cli/index.ts so batch.ts and unit tests can import the parser without invoking main(); added --quiet, --batch, --stop-on-fail.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant flag tokenizers stay pure — no I/O, no registry access; all effects flow through the caller

export interface CommonFlags {
  siteName: string | undefined;
  allSites: boolean;
  dryRun: boolean;
  force: boolean;
  noRegistryCache: boolean;
  concurrency: number | undefined;
  collectErrors: boolean;
  quiet: boolean;
  batch: string | undefined;
  stopOnFail: boolean;
  outputFormat: "pretty" | "json";
  remaining: string[];
}

/**
 * CLI-envelope flag names consumed before `run` dispatches — the union of
 * `consumeCommonFlags`, `isJsonFlagToken`, and `argvRequestsHelp` surfaces.
 * These tokens never reach `resolveCommandFlags`, so a documented
 * `werkstatt run <cmd> --flag` carrying one is valid even when the command's
 * own schema omits it. command.docs.lint (RFC-1313) derives its exemption
 * set from this list + KERNEL_UNIVERSAL_FLAGS — never a hardcoded copy.
 * Keep in sync with the parsers below (drift-guarded in index.test.ts).
 */
export const COMMON_CLI_FLAG_NAMES = [
  "site",
  "all",
  "dry-run",
  "force",
  "no-registry-cache",
  "concurrency",
  "collect-errors",
  "quiet",
  "batch",
  "stop-on-fail",
  "json",
  "output",
  "help",
  "h",
] as const;

export function consumeCommonFlags(argv: string[]): CommonFlags {
  const remaining: string[] = [];
  let siteName: string | undefined;
  let allSites = false;
  let dryRun = false;
  let force = false;
  let noRegistryCache = false;
  let concurrency: number | undefined;
  let collectErrors = false;
  let quiet = false;
  let batch: string | undefined;
  let stopOnFail = false;
  let outputFormat: "pretty" | "json" = "pretty";

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];

    if (entry === "--site") {
      siteName = argv[index + 1];
      index += 1;
      continue;
    }

    if (entry.startsWith("--site=")) {
      siteName = entry.slice("--site=".length);
      continue;
    }

    if (entry === "--all" || entry === "--all=true" || entry === "--all=1") {
      allSites = true;
      continue;
    }

    if (entry === "--dry-run" || entry === "--dry-run=true" || entry === "--dry-run=1") {
      dryRun = true;
      continue;
    }

    if (entry === "--force" || entry === "--force=true" || entry === "--force=1") {
      force = true;
      continue;
    }

    if (
      entry === "--no-registry-cache" ||
      entry === "--no-registry-cache=true" ||
      entry === "--no-registry-cache=1"
    ) {
      noRegistryCache = true;
      continue;
    }

    if (isJsonFlagToken(entry)) {
      outputFormat = "json";
      continue;
    }

    if (
      entry === "--collect-errors" ||
      entry === "--collect-errors=true" ||
      entry === "--collect-errors=1"
    ) {
      collectErrors = true;
      continue;
    }

    if (entry === "--concurrency") {
      const value = argv[index + 1];
      const parsed = Number.parseInt(value ?? "", 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        concurrency = parsed;
        index += 1;
      }
      continue;
    }

    if (entry.startsWith("--concurrency=")) {
      const parsed = Number.parseInt(entry.slice("--concurrency=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        concurrency = parsed;
      }
      continue;
    }

    if (entry === "--quiet" || entry === "--quiet=true" || entry === "--quiet=1") {
      quiet = true;
      continue;
    }

    if (entry === "--batch") {
      batch = argv[index + 1];
      index += 1;
      continue;
    }

    if (entry.startsWith("--batch=")) {
      batch = entry.slice("--batch=".length);
      continue;
    }

    if (
      entry === "--stop-on-fail" ||
      entry === "--stop-on-fail=true" ||
      entry === "--stop-on-fail=1"
    ) {
      stopOnFail = true;
      continue;
    }

    remaining.push(entry);
  }

  return {
    siteName,
    allSites,
    dryRun,
    force,
    noRegistryCache,
    concurrency,
    collectErrors,
    quiet,
    batch,
    stopOnFail,
    outputFormat,
    remaining,
  };
}

export function printUsage() {
  console.log("werkstatt sites list [--json]");
  console.log(
    "werkstatt run <command> [--site <name>] [--all] [--dry-run] [--no-registry-cache] [--quiet] [--json|--output] [-- ...args]",
  );
  console.log(
    "werkstatt run --batch <manifest> [--stop-on-fail] [--site <name>] [--all] [--dry-run] [--quiet] [--json]",
  );
  console.log(
    "werkstatt pipeline <name> [--site <name>] [--all] [--dry-run] [--force] [--no-registry-cache] [--concurrency N] [--collect-errors] [--quiet] [--json]",
  );
}

/**
 * RFC-0326: print a `[Modified N file(s): ...] Re-read before editing.` line
 * to stdout in pretty mode when the report has a non-empty filesModified array.
 * In JSON mode, filesModified is already a top-level field on the report — no
 * extra printing needed.
 */
export function printFilesModified(
  report: { filesModified?: string[] },
  outputFormat: "pretty" | "json",
): void {
  if (outputFormat === "json") return;
  const files = report.filesModified;
  if (!files || files.length === 0) return;
  console.log(`[Modified ${files.length} file(s): ${files.join(", ")}] Re-read before editing.`);
}

export function isJsonFlagToken(entry: string): boolean {
  return (
    entry === "--json" ||
    entry === "--json=true" ||
    entry === "--json=1" ||
    entry === "--output" ||
    entry === "--output=json" ||
    entry === "--output=true" ||
    entry === "--output=1"
  );
}

export function argvRequestsJson(argv: string[]): boolean {
  return argv.some(isJsonFlagToken);
}

export function argvRequestsHelp(argv: string[]): boolean {
  return argv.some((entry) => entry === "--help" || entry === "-h");
}
