/*
<MODULE_CONTRACT>
<purpose>
  RFC-0870: Provide a pipeline hint for error messages when a user accidentally
  uses a pipeline name as a command argument. Centralizes the known pipeline name
  list so both the CLI and runtime error paths can reference it.
</purpose>
<non-goals>
  <item>Do not validate pipeline registration — this is a static hint list only.</item>
  <item>Do not enumerate pipelines at runtime — the list is curated from kernel.config.ts and site module registrations.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0870: initial implementation — exported pipelineHint and KNOWN_PIPELINE_NAMES.</item>
</CHANGE_SUMMARY>
*/

/**
 * RFC-0870: Known pipeline names registered in kernel.config.ts and site modules.
 * Used to provide a helpful hint when a user accidentally uses a pipeline name
 * as a command argument.
 *
 * Source of truth: `pipelines` object in `tools/kernel.config.ts` (workspace-level)
 * and pipeline registrations in site module's `createStandardCheckModule` (app-level).
 * When a pipeline is added or renamed in either location, update this set.
 */
export const KNOWN_PIPELINE_NAMES = new Set([
  "build.prepare",
  "build.prepare.dev",
  "build.check",
  "build.post",
  "check",
  "compass",
  "integrity.release",
  "packages.check",
  "icons.generate",
  "sites.check",
  "sites.check.author",
  "sites.check.postbuild",
  "standard.compass",
  "mission-preflight.critical",
  "mission-preflight.warning",
]);

/**
 * RFC-0870: Build a pipeline hint message if the given name matches a known pipeline.
 * Returns an empty string if the name is not a known pipeline.
 */
export function pipelineHint(name: string): string {
  if (KNOWN_PIPELINE_NAMES.has(name)) {
    return `\nHint: '${name}' is a pipeline, not a command. Run 'werkstatt pipeline ${name}' instead, or use 'mission.validate' which executes the full pipeline.`;
  }
  return "";
}
