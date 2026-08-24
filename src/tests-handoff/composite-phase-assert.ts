/*
<MODULE_CONTRACT>
  <purpose>Test utility: validate that composite-command phase calls only pass flags the target command actually accepts.</purpose>
  <keywords>composite, phase, flag, validation, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0927 fix: extract flag names from argv and check against KERNEL_UNIVERSAL_FLAGS + command-specific flags.</item>
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
