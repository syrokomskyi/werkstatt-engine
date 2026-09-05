/*
<MODULE_CONTRACT>
<purpose>
RFC-1038: Declaration-time validation for kernel commands and components.
Replaces validateRegistration from werkstatt-site. Enforces fail-closed rules:
modulePath required on engine/site-plugin commands, generates required on
.generate commands, contract and rules required on validator commands.
</purpose>
<non-goals>
  <item>Does not validate generated file existence or staleness — that is the validators' job.</item>
  <item>Does not validate pipeline membership — that is ownership.sync.validate's job.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1038: initial implementation — extracted from validateRegistration, adapted for CommandDeclaration[] instead of KernelRegistry.</item>
</CHANGE_SUMMARY>
*/

import type { CommandDeclaration } from "./desired-state.ts";

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
}> = [
  {
    command: "block.id.generate",
    reason:
      "Backfill migration command (RFC-0914): modifies existing page content files in-place, does not create new generated files.",
  },
  {
    command: "docs.commands.generate",
    reason:
      "Workspace-scoped documentation generator (RFC-0222): writes docs/COMMANDS.md, not an app-scoped generated artifact.",
  },
  {
    command: "funnel.statechart.generate",
    reason:
      "Workspace-scoped documentation generator (RFC-0219): writes docs/specs/visitor-funnel/state-chart.generated.md, not an app-scoped generated artifact.",
  },
  {
    command: "ecosystem.manifest.generate",
    reason:
      "Workspace-scoped documentation generator (RFC-0245): writes docs/ecosystem.generated.yaml, not an app-scoped generated artifact.",
  },
  {
    command: "maintenance.debt.queue.generate",
    reason:
      "Workspace-scoped documentation generator (RFC-0256): writes docs/maintenance-debt.queues.generated.yaml, not an app-scoped generated artifact.",
  },
  {
    command: "gate.catalog.generate",
    reason:
      "Workspace-scoped documentation generator (RFC-0519): writes docs/gate-catalog.generated.yaml, not an app-scoped generated artifact.",
  },
  {
    command: "agent.dns-aid.generate",
    reason:
      "Site-registered DNS record generator (RFC-0786): writes to systems-cache/<id>/dns-records.yaml outside the app directory, not an app-scoped generated artifact.",
  },
  {
    command: "check.report.generate",
    reason:
      "Workspace-scoped report generator (RFC-0297): writes to .check-warpgogol/runs/**, not an app-scoped generated artifact.",
  },
  {
    command: "check.action-pack.generate",
    reason:
      "Workspace-scoped report generator (RFC-0297): writes to .check-warpgogol/runs/**, not an app-scoped generated artifact.",
  },
  {
    command: "public.artifact.generate",
    reason:
      "Aggregate generation boundary (RFC-0307): delegates to dedicated generators that own the actual files, does not produce new files itself.",
  },
  {
    command: "headers.security.generate",
    reason:
      "Security header generation boundary (RFC-0315): baseline headers are emitted by public.infrastructure.generate, this command does not produce new files itself.",
  },
  {
    command: "not-found.generate",
    reason:
      "Generation boundary (RFC-0310): routes.generate owns src/pages/404.astro, this command delegates and does not produce new files itself.",
  },
  {
    command: "ai.generate",
    reason:
      "Legacy AI policy generator (RFC-0051): ai.policy.generate (RFC-0313) now owns public/ai.txt, this command delegates and does not produce new files itself.",
  },
  {
    command: "gitattributes.generate",
    reason:
      "Workspace-scoped config generator (RFC-0336): rewrites the managed block in .gitattributes from ownership map data, not an app-scoped generated artifact.",
  },
  {
    command: "fleet.sites.generate",
    reason:
      "Workspace-scoped fleet config generator (RFC-0964): writes fleet/fleet.sites.yaml from systems-cache discovery, not an app-scoped generated artifact.",
  },
  {
    command: "nachweis.manifest.generate",
    reason:
      "Workspace-scoped nachweis generator (RFC-0707): writes to <cache>/public/nachweise/manifest.json outside the app directory, not an app-scoped generated artifact.",
  },
  {
    command: "sichtpass.generate",
    reason:
      "Workspace-scoped visibility snapshot generator (RFC-0947): appends Bordbuch entries, does not produce generated files in the app directory.",
  },
  {
    command: "signing.key.generate",
    reason:
      "Workspace-scoped key generator (RFC-0921): writes to a parameterized --output-dir, not an app-scoped generated artifact.",
  },
  {
    command: "sternsystem.passport.generate",
    reason:
      "Workspace-scoped passport generator (RFC-0966): writes signed passport.json to systems-cache/{id}/, not an app-scoped generated artifact.",
  },
];

const EXEMPT_COMMANDS = new Set(GENERATOR_OWNERSHIP_EXEMPT.map((e) => e.command));

function isGlobPath(path: string): boolean {
  return path.includes("*") || path.includes("{") || path.includes("?");
}

/**
 * RFC-1038: Validate command declarations after all modules are loaded.
 * Collects all violations and logs them as warnings (same behavior as
 * validateRegistration — warn-only, does not throw).
 *
 * Checks:
 * 1. Every command with a modulePath MUST have non-empty value.
 * 2. Every command with `writes` OR name ending `.generate` MUST have `generates`
 *    (>=1 entry OR `generates: []` for non-generating writes).
 *    `.generate` commands with `generates: []` must appear in GENERATOR_OWNERSHIP_EXEMPT.
 * 3. Non-glob path uniqueness across all `generates` entries.
 * 4. RFC-0963: Validator commands (name matching *.validate|*.check|*.lint) SHOULD
 *    declare `contract` and `rules`. Warn-only.
 */
export function validateDeclarations(commands: ReadonlyMap<string, CommandDeclaration>): void {
  const errors: string[] = [];
  const seenNonGlobPaths = new Map<string, string>();

  for (const [commandName, command] of commands) {
    if (command.modulePath === undefined) continue;

    if (command.modulePath.trim().length === 0) {
      errors.push(
        `Command \`${commandName}\` is missing required \`modulePath\` (repo-relative path to implementation source file).`,
      );
    }

    const isGenerateCommand = commandName.endsWith(".generate");
    const hasWrites = command.writes && command.writes.length > 0;

    if (isGenerateCommand || hasWrites) {
      if (command.generates === undefined) {
        errors.push(
          `Command \`${commandName}\` must declare \`generates\` (it ${isGenerateCommand ? "has a .generate suffix" : "has writes"}. Add generates: [...] or generates: [] for non-generating writes${isGenerateCommand ? " (and list in GENERATOR_OWNERSHIP_EXEMPT with a reason if generates: [])" : ""}).`,
        );
      } else if (isGenerateCommand && command.generates.length === 0) {
        if (!EXEMPT_COMMANDS.has(commandName)) {
          errors.push(
            `Command \`${commandName}\` has \`.generate\` suffix and \`generates: []\` but is not in GENERATOR_OWNERSHIP_EXEMPT. Add it with a reason or declare actual generates entries.`,
          );
        }
      }
    }

    const isValidatorCommand =
      commandName.endsWith(".validate") ||
      commandName.endsWith(".check") ||
      commandName.endsWith(".lint");

    if (isValidatorCommand) {
      if (command.contract === undefined) {
        errors.push(
          `Command \`${commandName}\` is a validator but does not declare \`contract\` (RFC-0963). Add a contract tag to group this validator with others enforcing the same surface.`,
        );
      }
      if (command.rules === undefined) {
        errors.push(
          `Command \`${commandName}\` is a validator but does not declare \`rules\` (RFC-0963). Add the rule IDs this validator enforces.`,
        );
      }
    }

    if (command.generates) {
      for (const spec of command.generates) {
        if (!isGlobPath(spec.path)) {
          const existingOwner = seenNonGlobPaths.get(spec.path);
          if (existingOwner) {
            errors.push(
              `Non-glob path \`${spec.path}\` is claimed by both \`${existingOwner}\` and \`${commandName}\`. Generated file ownership must be unique.`,
            );
          } else {
            seenNonGlobPaths.set(spec.path, commandName);
          }
        }
      }
    }
  }

  for (const exempt of GENERATOR_OWNERSHIP_EXEMPT) {
    if (!commands.has(exempt.command)) {
      errors.push(
        `GENERATOR_OWNERSHIP_EXEMPT entry \`${exempt.command}\` does not match any registered command.`,
      );
    }
  }

  if (errors.length > 0) {
    console.warn(
      `Declaration validation (${errors.length} violation(s)):\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
}
