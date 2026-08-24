/*
<MODULE_CONTRACT>
<purpose>
Argv-to-flags parsing for kernel commands: the legacy global-heuristic parser
(parseKernelArgv) and the RFC-0260 schema-driven parser (resolveCommandFlags)
that resolves flags strictly against a command's declared (+ universal) flag
schema.
</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0303: split out of runtime.ts (Phase 3 file-size split, hot-path file 8/8).</item>
</CHANGE_SUMMARY>
*/

import type {
  Diagnostic,
  KernelCommandDefinition,
  KernelFlagSpec,
  KernelFlagValue,
} from "../types.ts";

const _VALUE_FLAG_NAMES = new Set(["root", "package", "history"]);

function addFlagValue(
  target: Record<string, KernelFlagValue>,
  key: string,
  value: string | boolean,
) {
  const existing = target[key];

  if (existing === undefined) {
    target[key] = value;
    return;
  }

  if (Array.isArray(existing)) {
    if (typeof value === "string") {
      target[key] = [...existing, value];
    }
    return;
  }

  if (typeof existing === "string") {
    if (typeof value === "string") {
      target[key] = [existing, value];
      return;
    }

    target[key] = existing;
    return;
  }

  target[key] = value;
}

/**
 * @deprecated RFC-0260: this global heuristic set only governs the legacy parse
 * path used by commands that do NOT declare a `flags` schema. Schema-carrying
 * commands are parsed by {@link resolveCommandFlags} instead, which decides
 * boolean-ness from the command's own (and the universal) flag specs. Once
 * every command has migrated to a `flags` schema, this set and the heuristic
 * path in {@link parseKernelArgv} are deleted (RFC-0260 rollout step 4).
 *
 * Flags that are always boolean switches. A boolean flag never consumes the following token as its
 * value, so `--dry-run alpha` parses as the boolean `dry-run` plus the positional `alpha` (rather
 * than greedily swallowing `alpha`). Value flags (`--site x`, `--root y`, `--tag z`) are NOT listed
 * and keep consuming the next bare token. The set is the union of every flag the kernel commands
 * read as a boolean (`flags.x === true`) plus the universal CLI switches.
 */
const KERNEL_BOOLEAN_FLAGS = new Set<string>([
  "all",
  "all-apps",
  "approve-all",
  "dry-run",
  "force",
  "help",
  "inplace",
  "json",
  "mini",
  "packages",
  "page",
  "prod",
  "quiet",
  "regen",
  "regenerate",
  "report-only",
  "show-versions",
  "strict",
  "verbose",
  "version",
  "write",
]);

export function parseKernelArgv(argv: string[]): {
  argv: string[];
  flags: Record<string, KernelFlagValue>;
  diagnostics: Diagnostic[];
} {
  const flags: Record<string, KernelFlagValue> = {};
  const diagnostics: Diagnostic[] = [];
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];

    if (passthrough) {
      diagnostics.push({
        ruleId: "KERNEL-ARG-01",
        severity: "error",
        message: `Unexpected positional argument "${entry}". All arguments must be passed as flags.`,
        fixHint: `Convert "${entry}" to a flag, e.g. --id ${entry}.`,
      });
      continue;
    }

    if (entry === "--") {
      passthrough = true;
      continue;
    }

    if (!entry.startsWith("--")) {
      diagnostics.push({
        ruleId: "KERNEL-ARG-01",
        severity: "error",
        message: `Unexpected positional argument "${entry}". All arguments must be passed as flags.`,
        fixHint: `Convert "${entry}" to a flag, e.g. --id ${entry}.`,
      });
      continue;
    }

    const withoutPrefix = entry.slice(2);
    const [flagName, inlineValue] = withoutPrefix.split("=", 2);

    if (!flagName) {
      continue;
    }

    if (inlineValue !== undefined) {
      addFlagValue(flags, flagName, inlineValue);
      continue;
    }

    // Boolean switches never consume the following token; it stays a positional arg.
    if (KERNEL_BOOLEAN_FLAGS.has(flagName)) {
      addFlagValue(flags, flagName, true);
      continue;
    }

    const next = argv[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      addFlagValue(flags, flagName, next);
      index += 1;
      continue;
    }

    addFlagValue(flags, flagName, true);
  }

  return {
    argv: [...argv],
    flags,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// RFC-0260: typed kernel command flag schemas
// ---------------------------------------------------------------------------

/**
 * Flags every kernel command accepts regardless of its own declared schema.
 * Merged into every schema-carrying command before flags are resolved, so an
 * individual command's `flags` map only needs to declare what is specific to
 * it (RFC-0260).
 */
export const KERNEL_UNIVERSAL_FLAGS: Record<string, KernelFlagSpec> = {
  site: { kind: "string", description: "Target a specific site by name (RFC-0378)." },
  all: { kind: "boolean", description: "Run against every discovered app." },
  json: { kind: "boolean", description: "Emit machine-readable JSON instead of pretty output." },
  quiet: { kind: "boolean", description: "Suppress non-essential log output." },
  verbose: { kind: "boolean", description: "Emit additional diagnostic log output." },
  root: { kind: "string", description: "Override the resolved workspace root." },
  "dry-run": { kind: "boolean", description: "Report intended mutations without writing them." },
  force: { kind: "boolean", description: "Bypass a normally-blocking safety check." },
  help: { kind: "boolean", description: "Print command help instead of executing." },
};

/**
 * RFC-0260: resolve raw argv against a command's declared flag schema
 * (merged with {@link KERNEL_UNIVERSAL_FLAGS}). Unlike {@link parseKernelArgv},
 * boolean-ness is decided per-flag from the schema instead of a global
 * heuristic set, so an unknown flag is a hard error (KERNEL-FLAG-01) instead
 * of being silently accepted as `true`.
 *
 * Passthrough semantics are unchanged: tokens after a bare `--` are never
 * flag-interpreted and produce KERNEL-ARG-01 diagnostics per RFC-0609.
 */
export function resolveCommandFlags(
  rawArgv: string[],
  definition: KernelCommandDefinition,
): { flags: Record<string, KernelFlagValue>; diagnostics: Diagnostic[] } {
  const schema: Record<string, KernelFlagSpec> = {
    ...KERNEL_UNIVERSAL_FLAGS,
    ...(definition.flags ?? {}),
  };
  const validFlagNames = Object.keys(schema).sort();
  const flags: Record<string, KernelFlagValue> = {};
  const diagnostics: Diagnostic[] = [];
  let passthrough = false;

  for (let index = 0; index < rawArgv.length; index += 1) {
    const entry = rawArgv[index];

    if (passthrough) {
      diagnostics.push({
        ruleId: "KERNEL-ARG-01",
        severity: "error",
        message: `Unexpected positional argument "${entry}" for command "${definition.name}". All arguments must be passed as flags.`,
        fixHint: `Convert "${entry}" to a flag, e.g. --id ${entry}.`,
      });
      continue;
    }

    if (entry === "--") {
      passthrough = true;
      continue;
    }

    if (!entry.startsWith("--")) {
      diagnostics.push({
        ruleId: "KERNEL-ARG-01",
        severity: "error",
        message: `Unexpected positional argument "${entry}" for command "${definition.name}". All arguments must be passed as flags.`,
        fixHint: `Convert "${entry}" to a flag, e.g. --id ${entry}.`,
      });
      continue;
    }

    const withoutPrefix = entry.slice(2);
    const [flagName, inlineValue] = withoutPrefix.split("=", 2);
    if (!flagName) continue;

    const spec = schema[flagName];
    if (!spec) {
      diagnostics.push({
        ruleId: "KERNEL-FLAG-01",
        severity: "error",
        message: `Unknown flag "--${flagName}" for command "${definition.name}". Valid flags: ${validFlagNames.join(", ")}`,
        fixHint: `Remove --${flagName}, fix the typo, or add it to the flags schema for ${definition.name}.`,
      });
      continue;
    }

    if (inlineValue !== undefined) {
      addFlagValue(
        flags,
        flagName,
        spec.kind === "boolean" ? inlineValue !== "false" : inlineValue,
      );
      continue;
    }

    if (spec.kind === "boolean") {
      addFlagValue(flags, flagName, true);
      continue;
    }

    const next = rawArgv[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      addFlagValue(flags, flagName, next);
      index += 1;
      continue;
    }

    diagnostics.push({
      ruleId: "KERNEL-FLAG-02",
      severity: "error",
      message: `Flag "--${flagName}" for command "${definition.name}" requires a value but none was given.`,
      fixHint: `Pass --${flagName} <value> or --${flagName}=<value>.`,
    });
  }

  for (const [flagName, spec] of Object.entries(schema)) {
    if (spec.required && flags[flagName] === undefined) {
      diagnostics.push({
        ruleId: "KERNEL-FLAG-03",
        severity: "error",
        message: `Required flag "--${flagName}" is missing for command "${definition.name}".`,
        fixHint: `Pass --${flagName} <value>.`,
      });
    } else if (flags[flagName] === undefined && spec.default !== undefined) {
      flags[flagName] = spec.default;
    }
  }

  return { flags, diagnostics };
}
