/*
<MODULE_CONTRACT>
<purpose>validate-declarations — declaration-time validation for kernel commands and components (RFC-1038).</purpose>
<non-goals>
  <item>Does not validate generated file existence or staleness — that is the validators' job.</item>
  <item>Does not validate pipeline membership — that is ownership.sync.validate's job.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1038: initial implementation — extracted from validateRegistration, adapted for CommandDeclaration[] instead of KernelRegistry.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1138: pipeline hygiene — module-scoped exempt entries, archive gitignore guard, dns upsert to deploy phases, promote auto-sync, rfc.create claim protocol, siteHasRuntime filter</item>
  <item>RFC-1138: scope all remaining exempt entries — 15 site-plugin commands to check (ALL_COMMANDS), nachweis.manifest.generate to nachweis, sichtpass.generate to sichtpass; stops stale-entry warnings in registries without those modules.</item>
  <item>RFC-1173: declare mutatesState on all kernel commands — collectDeclarationDiagnostics emits error-severity MUTATES-STATE-DECLARED, command.manifest.validate is the blocking consumer in packages.check, sweep declares the flag on every command definition (factories hardcode false for read-only check specs)</item>
</CHANGE_SUMMARY>
*/

import type { CommandDeclaration } from "@warpgogol/werkstatt-shared/kernel";

/**
 * Commands legitimately exempt from declaring `generates` entries despite having
 * a `.generate` suffix. Each entry must carry a human-readable reason.
 *
 * Criteria for exemption:
 * 1. The command declares no `writes` (no output files), OR
 * 2. All its `writes` are covered by other commands' `generates` declarations.
 */
export const GENERATOR_OWNERSHIP_EXEMPT: ReadonlyArray<{
  command: string;
  reason: string;
  /**
   * RFC-1138: module that registers this command. The stale-entry check only
   * fires when this module was loaded into the registry being validated —
   * site registries load only site-plugin modules, so engine commands would
   * otherwise always report as "stale".
   */
  module?: string;
}> = [
  {
    command: "block.id.generate",
    reason:
      "Backfill migration command (RFC-0914): modifies existing page content files in-place, does not create new generated files.",
    module: "check",
  },
  {
    command: "docs.commands.generate",
    reason:
      "Workspace-scoped documentation generator (RFC-0222): writes docs/COMMANDS.md, not an app-scoped generated artifact.",
    module: "check",
  },
  {
    command: "rfc.index.generate",
    reason:
      "Workspace doc index (RFC-0260): docs/rfcs/index.yaml is written only under --write and carries no GENERATED marker — not a marker-tracked artifact.",
    module: "rfc",
  },
  {
    command: "forge.agents.generate",
    reason:
      "AGENTS.md instruction files are marker-merge documents (RFC-1150 skips hand-written files) — workspace docs, not app-scoped generated artifacts.",
    module: "forge-core",
  },
  {
    command: "funnel.statechart.generate",
    reason:
      "Workspace-scoped documentation generator (RFC-0219): writes docs/specs/visitor-funnel/state-chart.generated.md, not an app-scoped generated artifact.",
    module: "check",
  },
  {
    command: "ecosystem.manifest.generate",
    reason:
      "Workspace-scoped documentation generator (RFC-0245): writes docs/ecosystem.generated.yaml, not an app-scoped generated artifact.",
    module: "check",
  },
  {
    command: "maintenance.debt.queue.generate",
    reason:
      "Workspace-scoped documentation generator (RFC-0256): writes docs/maintenance-debt.queues.generated.yaml, not an app-scoped generated artifact.",
    module: "check",
  },
  {
    command: "gate.catalog.generate",
    reason:
      "Workspace-scoped documentation generator (RFC-0519): writes docs/gate-catalog.generated.yaml, not an app-scoped generated artifact.",
    module: "check",
  },
  {
    command: "agent.dns-aid.generate",
    reason:
      "Site-registered DNS record generator (RFC-0786): writes to systems-cache/<id>/dns-records.yaml outside the app directory, not an app-scoped generated artifact.",
    module: "check",
  },
  {
    command: "check.report.generate",
    reason:
      "Workspace-scoped report generator (RFC-0297): writes to .check-warpgogol/runs/**, not an app-scoped generated artifact.",
    module: "check",
  },
  {
    command: "check.action-pack.generate",
    reason:
      "Workspace-scoped report generator (RFC-0297): writes to .check-warpgogol/runs/**, not an app-scoped generated artifact.",
    module: "check",
  },
  {
    command: "public.artifact.generate",
    reason:
      "Aggregate generation boundary (RFC-0307): delegates to dedicated generators that own the actual files, does not produce new files itself.",
    module: "check",
  },
  {
    command: "headers.security.generate",
    reason:
      "Security header generation boundary (RFC-0315): baseline headers are emitted by public.infrastructure.generate, this command does not produce new files itself.",
    module: "check",
  },
  {
    command: "not-found.generate",
    reason:
      "Generation boundary (RFC-0310): routes.generate owns src/pages/404.astro, this command delegates and does not produce new files itself.",
    module: "check",
  },
  {
    command: "ai.generate",
    reason:
      "Legacy AI policy generator (RFC-0051): ai.policy.generate (RFC-0313) now owns public/ai.txt, this command delegates and does not produce new files itself.",
    module: "check",
  },
  {
    command: "gitattributes.generate",
    reason:
      "Workspace-scoped config generator (RFC-0336): rewrites the managed block in .gitattributes from ownership map data, not an app-scoped generated artifact.",
    module: "check",
  },
  {
    command: "fleet.sites.generate",
    reason:
      "Workspace-scoped fleet config generator (RFC-0964): writes fleet/fleet.sites.yaml from systems-cache discovery, not an app-scoped generated artifact.",
    module: "fleet",
  },
  {
    command: "nachweis.manifest.generate",
    reason:
      "Workspace-scoped nachweis generator (RFC-0707): writes to <cache>/public/nachweise/manifest.json outside the app directory, not an app-scoped generated artifact.",
    module: "nachweis",
  },
  {
    command: "sichtpass.generate",
    reason:
      "Workspace-scoped visibility snapshot generator (RFC-0947): appends Bordbuch entries, does not produce generated files in the app directory.",
    module: "sichtpass",
  },
  {
    command: "signing.key.generate",
    reason:
      "Workspace-scoped key generator (RFC-0921): writes to a parameterized --output-dir, not an app-scoped generated artifact.",
    module: "signing",
  },
  {
    command: "sternsystem.passport.generate",
    reason:
      "Workspace-scoped passport generator (RFC-0966): writes signed passport.json to systems-cache/{id}/, not an app-scoped generated artifact.",
    module: "sternsystem",
  },
  {
    command: "site.exports.generate",
    reason:
      "Workspace-scoped exports-map generator (RFC-1101): rewrites packages/werkstatt-site/package.json exports in place — the manifest itself, not an app-scoped generated artifact.",
    module: "check",
  },
];

const EXEMPT_COMMANDS = new Set(GENERATOR_OWNERSHIP_EXEMPT.map((e) => e.command));

function isGlobPath(path: string): boolean {
  return path.includes("*") || path.includes("{") || path.includes("?");
}

/**
 * RFC-1173: structured declaration diagnostic — machine-consumable form of
 * the checks below. `severity: "error"` entries are blocking where a
 * consumer chooses to block (command.manifest.validate); "warn" entries keep
 * the historical warn-only behavior.
 */
export interface DeclarationDiagnostic {
  ruleId: string;
  severity: "error" | "warn";
  command: string;
  message: string;
}

/**
 * RFC-1173: collect declaration diagnostics for all registered commands.
 * Structured replacement for the former plain-string collection — callers
 * decide how to surface each entry (registry build logs them as warnings;
 * command.manifest.validate blocks on severity "error").
 *
 * Checks:
 * 1. Every command with a modulePath MUST have non-empty value. (warn)
 * 2. Every command with `writes` OR name ending `.generate` MUST have `generates`
 *    (>=1 entry OR `generates: []` for non-generating writes). (warn)
 *    `.generate` commands with `generates: []` must appear in GENERATOR_OWNERSHIP_EXEMPT.
 * 3. Non-glob path uniqueness across all `generates` entries. (warn)
 * 4. RFC-0963: Validator commands (name matching *.validate|*.check|*.lint) SHOULD
 *    declare `contract` and `rules`. (warn)
 * 5. RFC-1173: Every command MUST declare `mutatesState` explicitly —
 *    undeclared ⇒ conservatively treated as mutating by the scheduler.
 *    (error — consumed as blocking by command.manifest.validate)
 * 6. RFC-1173: A command declaring non-empty `writes`/`generates` MUST NOT
 *    declare `mutatesState: false` — declared outputs imply mutation; `false`
 *    marks the step safe to run tainted under collect-errors, the unsafe
 *    direction. (warn — 19 commands misclassified this way in the initial
 *    sweep, fixed in 6.320.0)
 */
export function collectDeclarationDiagnostics(
  commands: ReadonlyMap<string, CommandDeclaration>,
  opts?: { loadedModules?: ReadonlySet<string> },
): DeclarationDiagnostic[] {
  const diagnostics: DeclarationDiagnostic[] = [];
  const seenNonGlobPaths = new Map<string, string>();

  for (const [commandName, command] of commands) {
    if (command.modulePath === undefined) continue;

    if (command.modulePath.trim().length === 0) {
      diagnostics.push({
        ruleId: "MODULE-PATH-MISSING",
        severity: "warn",
        command: commandName,
        message: `Command \`${commandName}\` is missing required \`modulePath\` (repo-relative path to implementation source file).`,
      });
    }

    if (command.mutatesState === undefined) {
      diagnostics.push({
        ruleId: "MUTATES-STATE-DECLARED",
        severity: "error",
        command: commandName,
        message: `Command \`${commandName}\` does not declare \`mutatesState\` (RFC-1173). Add \`mutatesState: false\` for read-only commands or \`mutatesState: true\` for mutating ones.`,
      });
    }

    const isGenerateCommand = commandName.endsWith(".generate");
    const hasWrites = command.writes && command.writes.length > 0;
    const hasGenerates = command.generates !== undefined && command.generates.length > 0;

    if (command.mutatesState === false && (hasWrites || hasGenerates)) {
      diagnostics.push({
        ruleId: "MUTATES-STATE-WRITES-MISMATCH",
        severity: "warn",
        command: commandName,
        message: `Command \`${commandName}\` declares ${hasWrites ? "writes" : "generates"} but \`mutatesState: false\` (RFC-1173). Declared outputs imply mutation — \`false\` marks the step safe to run tainted under collect-errors. Either set \`mutatesState: true\` or remove the declared outputs if they are stale.`,
      });
    }

    if (isGenerateCommand || hasWrites) {
      if (command.generates === undefined) {
        diagnostics.push({
          ruleId: "GENERATES-MISSING",
          severity: "warn",
          command: commandName,
          message: `Command \`${commandName}\` must declare \`generates\` (it ${isGenerateCommand ? "has a .generate suffix" : "has writes"}. Add generates: [...] or generates: [] for non-generating writes${isGenerateCommand ? " (and list in GENERATOR_OWNERSHIP_EXEMPT with a reason if generates: [])" : ""}).`,
        });
      } else if (isGenerateCommand && command.generates.length === 0) {
        if (!EXEMPT_COMMANDS.has(commandName)) {
          diagnostics.push({
            ruleId: "GENERATOR-EXEMPT-MISSING",
            severity: "warn",
            command: commandName,
            message: `Command \`${commandName}\` has \`.generate\` suffix and \`generates: []\` but is not in GENERATOR_OWNERSHIP_EXEMPT. Add it with a reason or declare actual generates entries.`,
          });
        }
      }
    }

    const isValidatorCommand =
      commandName.endsWith(".validate") ||
      commandName.endsWith(".check") ||
      commandName.endsWith(".lint");

    if (isValidatorCommand) {
      if (command.contract === undefined) {
        diagnostics.push({
          ruleId: "VALIDATOR-CONTRACT-MISSING",
          severity: "warn",
          command: commandName,
          message: `Command \`${commandName}\` is a validator but does not declare \`contract\` (RFC-0963). Add a contract tag to group this validator with others enforcing the same surface.`,
        });
      }
      if (command.rules === undefined) {
        diagnostics.push({
          ruleId: "VALIDATOR-RULES-MISSING",
          severity: "warn",
          command: commandName,
          message: `Command \`${commandName}\` is a validator but does not declare \`rules\` (RFC-0963). Add the rule IDs this validator enforces.`,
        });
      }
    }

    if (command.generates) {
      for (const spec of command.generates) {
        if (!isGlobPath(spec.path)) {
          const existingOwner = seenNonGlobPaths.get(spec.path);
          if (existingOwner) {
            diagnostics.push({
              ruleId: "GENERATES-PATH-COLLISION",
              severity: "warn",
              command: commandName,
              message: `Non-glob path \`${spec.path}\` is claimed by both \`${existingOwner}\` and \`${commandName}\`. Generated file ownership must be unique.`,
            });
          } else {
            seenNonGlobPaths.set(spec.path, commandName);
          }
        }
      }
    }
  }

  for (const exempt of GENERATOR_OWNERSHIP_EXEMPT) {
    // RFC-1138: module-scoped entries are only stale when their owning module
    // was loaded — site registries never load engine modules, so checking
    // them there produces false "stale" warnings on every registry build.
    if (exempt.module && opts?.loadedModules && !opts.loadedModules.has(exempt.module)) {
      continue;
    }
    if (!commands.has(exempt.command)) {
      diagnostics.push({
        ruleId: "GENERATOR-EXEMPT-STALE",
        severity: "warn",
        command: exempt.command,
        message: `GENERATOR_OWNERSHIP_EXEMPT entry \`${exempt.command}\` does not match any registered command.`,
      });
    }
  }

  return diagnostics;
}

/**
 * RFC-1038: Validate command declarations after all modules are loaded.
 * Collects all violations and logs them as warnings (same behavior as
 * validateRegistration — warn-only, does not throw). RFC-1173: diagnostics
 * are now produced by collectDeclarationDiagnostics; the error-severity
 * MUTATES-STATE-DECLARED entries additionally block via
 * command.manifest.validate (PACKAGES_CHECK_PIPELINE).
 */
export function validateDeclarations(
  commands: ReadonlyMap<string, CommandDeclaration>,
  opts?: { loadedModules?: ReadonlySet<string> },
): void {
  const diagnostics = collectDeclarationDiagnostics(commands, opts);

  if (diagnostics.length > 0) {
    console.warn(
      `Declaration validation (${diagnostics.length} violation(s)):\n${diagnostics
        .map((d) => `  - [${d.ruleId}] ${d.message}`)
        .join("\n")}`,
    );
  }
}
