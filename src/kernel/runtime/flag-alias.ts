/*
<MODULE_CONTRACT>
<purpose>
RFC-1126: --site flag alias resolution for workspace-scoped kernel commands.
Agents habitually pass --site <id> to mission.* and sternsystem.* commands;
before this resolver the flag was accepted as a universal flag and silently
ignored, so the command ran against the wrong target. The resolver rewrites
--site into the command's canonical targeting flag before schema resolution:
mission → open-mission lookup by system id, id → direct alias, system →
direct alias.
</purpose>
<non-goals>
  <item>Does not apply to site-scoped commands — for them --site is the canonical site selector consumed by ensureTargetSites.</item>
  <item>Does not apply when the command declares its own `site` flag (leitstand.*, sternsystem.extract) — there --site is canonical, not an alias.</item>
  <item>Does not invent new targeting flags — only rewrites into flags the command already declares.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Canonical flag wins on identical targets; conflicting targets are a blocking KERNEL-FLAG-02 error, never a silent pick.</item>
  <item>Mission resolution scans missions/<systemId>-m* manifests for state "open" — zero matches and multiple matches are both blocking errors with agent-actionable messages.</item>
  <item>Resolution runs inside executeRegisteredCommand before resolveCommandFlags — the single choke point for pipeline steps and direct executeKernelCommand calls.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1126: initial implementation — resolveSiteFlagAlias with mission/id/system target mapping and conflict diagnostics.</item>
  <item>RFC-1126: step 2 — kernel runtime wiring

Populate KernelRuntimeContext.workpieceEnv at all 5 context construction sites (execute-command + execute-pipeline); add resolveSiteFlagAlias rewriting --site into --mission/--id/--system for workspace-scoped commands with KERNEL-FLAG-02 conflict diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { listMissionDirs, readMissionManifest } from "../../mission/mission-io.ts";
import type { Diagnostic, KernelCommandDefinition } from "@warpgogol/werkstatt-shared/kernel";

interface SiteFlagOccurrence {
  /** Index of the `--site` token (or the `--site=value` token). */
  index: number;
  /** True when the value was inline (`--site=x`); false when it is the next token. */
  inline: boolean;
  value: string;
}

function findSiteFlag(argv: string[]): SiteFlagOccurrence | undefined {
  for (let i = 0; i < argv.length; i++) {
    const entry = argv[i]!;
    if (entry === "--") return undefined;
    if (entry === "--site") {
      const next = argv[i + 1];
      if (typeof next === "string" && !next.startsWith("--")) {
        return { index: i, inline: false, value: next };
      }
      return undefined;
    }
    if (entry.startsWith("--site=")) {
      return { index: i, inline: true, value: entry.slice("--site=".length) };
    }
  }
  return undefined;
}

function findCanonicalFlagValue(argv: string[], flag: string): string | undefined {
  const inlinePrefix = `--${flag}=`;
  for (let i = 0; i < argv.length; i++) {
    const entry = argv[i]!;
    if (entry === "--") return undefined;
    if (entry === `--${flag}`) {
      const next = argv[i + 1];
      if (typeof next === "string" && !next.startsWith("--")) return next;
      return undefined;
    }
    if (entry.startsWith(inlinePrefix)) {
      return entry.slice(inlinePrefix.length);
    }
  }
  return undefined;
}

/** Remove the `--site` occurrence (and its separate value token when not inline). */
function removeSiteFlag(argv: string[], occurrence: SiteFlagOccurrence): string[] {
  const out = [...argv];
  out.splice(occurrence.index, occurrence.inline ? 1 : 2);
  return out;
}

function flagError(message: string, fixHint: string): Diagnostic {
  return { ruleId: "KERNEL-FLAG-02", severity: "error", message, fixHint };
}

/**
 * Resolve the open mission id for a system by scanning missions/<systemId>-m*
 * manifests. Returns the mission id, or a Diagnostic when zero or multiple
 * open missions exist.
 */
async function resolveOpenMission(
  workspaceRoot: string,
  systemId: string,
): Promise<{ missionId: string } | { diagnostic: Diagnostic }> {
  const dirs = await listMissionDirs(workspaceRoot, systemId);
  const open: string[] = [];
  for (const dir of dirs) {
    try {
      const manifest = await readMissionManifest(workspaceRoot, dir);
      if (manifest.state === "open") open.push(manifest.missionId);
    } catch {
      // Unreadable manifest — not an open mission candidate.
    }
  }
  if (open.length === 1) {
    return { missionId: open[0]! };
  }
  if (open.length === 0) {
    return {
      diagnostic: flagError(
        `--site ${systemId}: no open mission found for this Sternsystem.`,
        `Open one first: mission.open --system ${systemId} --brief "<brief>", or pass --mission <id> explicitly.`,
      ),
    };
  }
  return {
    diagnostic: flagError(
      `--site ${systemId}: multiple open missions found (${open.join(", ")}).`,
      `Pass --mission <id> explicitly to disambiguate.`,
    ),
  };
}

/**
 * Rewrite `--site <value>` in argv into the command's canonical targeting
 * flag. Returns the (possibly unchanged) argv plus an optional error
 * diagnostic that the caller merges into the flag-resolution diagnostics.
 */
export async function resolveSiteFlagAlias(
  argv: string[],
  command: KernelCommandDefinition,
  workspaceRoot: string,
): Promise<{ argv: string[]; diagnostic?: Diagnostic }> {
  // Site-scoped commands use --site as the canonical site selector.
  if (command.scope !== "workspace" || !command.flags) {
    return { argv };
  }
  // Commands declaring their own `site` flag (leitstand.*, sternsystem.extract)
  // treat --site as canonical — never an alias.
  if ("site" in command.flags) {
    return { argv };
  }
  const occurrence = findSiteFlag(argv);
  if (!occurrence) {
    return { argv };
  }
  const siteValue = occurrence.value;

  // Priority: mission > id > system — the first declared flag wins the alias.
  if ("mission" in command.flags && command.flags.mission!.kind === "string") {
    const canonical = findCanonicalFlagValue(argv, "mission");
    if (canonical !== undefined) {
      // Both present: identical targets → canonical wins silently.
      try {
        const manifest = await readMissionManifest(workspaceRoot, canonical);
        if (manifest.systemId === siteValue) {
          return { argv: removeSiteFlag(argv, occurrence) };
        }
      } catch {
        // Mission manifest unreadable — canonical flag stays authoritative.
        return { argv: removeSiteFlag(argv, occurrence) };
      }
      return {
        argv,
        diagnostic: flagError(
          `Conflicting targets: --mission ${canonical} does not belong to --site ${siteValue}.`,
          `Pass either --mission ${canonical} or --site ${siteValue}, not both.`,
        ),
      };
    }
    const resolved = await resolveOpenMission(workspaceRoot, siteValue);
    if ("diagnostic" in resolved) {
      return { argv, diagnostic: resolved.diagnostic };
    }
    const out = removeSiteFlag(argv, occurrence);
    out.push("--mission", resolved.missionId);
    return { argv: out };
  }

  const targetFlag =
    "id" in command.flags && command.flags.id!.kind === "string"
      ? "id"
      : "system" in command.flags && command.flags.system!.kind === "string"
        ? "system"
        : undefined;
  if (!targetFlag) {
    return { argv };
  }

  const canonical = findCanonicalFlagValue(argv, targetFlag);
  if (canonical !== undefined) {
    if (canonical === siteValue) {
      return { argv: removeSiteFlag(argv, occurrence) };
    }
    return {
      argv,
      diagnostic: flagError(
        `Conflicting targets: --${targetFlag} ${canonical} vs --site ${siteValue}.`,
        `Pass either --${targetFlag} ${canonical} or --site ${siteValue}, not both.`,
      ),
    };
  }

  const out = removeSiteFlag(argv, occurrence);
  out.push(`--${targetFlag}`, siteValue);
  return { argv: out };
}
