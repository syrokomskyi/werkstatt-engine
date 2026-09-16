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
<KEY_DECISIONS>
  <item>Hints are generated for error messages only — they never alter execution.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0870: initial implementation — exported pipelineHint and KNOWN_PIPELINE_NAMES.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
