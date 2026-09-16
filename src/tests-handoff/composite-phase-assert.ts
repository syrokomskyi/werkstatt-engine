/*
<MODULE_CONTRACT>
  <purpose>Test utility: validate that composite-command phase calls only pass flags the target command actually accepts.</purpose>

<non-goals>
  <item>Do not use in production — this assertion helper exists for handoff tests only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0927 fix: extract flag names from argv and check against KERNEL_UNIVERSAL_FLAGS + command-specific flags.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { KERNEL_UNIVERSAL_FLAGS } from "@warpgogol/werkstatt-engine/kernel";

/**
 * Extract flag names from an argv array. Handles both `--flag value` and `--flag=value` forms.
 * Returns flag names without the `--` prefix.
 */
export function extractFlagNames(argv: string[]): string[] {
  return argv
    .filter((a) => a.startsWith("--") && !a.startsWith("---"))
    .map((a) => a.slice(2).split("=")[0])
    .filter(Boolean);
}

/**
 * Assert that all flags in argv are valid for the given command.
 *
 * @param argv The argv passed to the sub-command.
 * @param commandSpecificFlags Flag names declared by the command's `flags` schema (not including universal flags).
 * @param commandName Command name for the error message.
 * @param compositeName Composite command name for the error message.
 * @throws If any flag in argv is not in the valid set.
 */
export function assertNoUnknownFlags(
  argv: string[],
  commandSpecificFlags: string[],
  commandName: string,
  compositeName: string,
): void {
  const validFlags = new Set([
    ...Object.keys(KERNEL_UNIVERSAL_FLAGS),
    ...commandSpecificFlags,
  ]);
  const flags = extractFlagNames(argv);
  const unknown = flags.filter((f) => !validFlags.has(f));
  if (unknown.length > 0) {
    throw new Error(
      `Test assertion failed: ${compositeName} passed unknown flag(s) to ${commandName}: ` +
        unknown.map((f) => `--${f}`).join(", ") +
        `. Valid flags: ${[...validFlags].sort().join(", ")}`,
    );
  }
}
