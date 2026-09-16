/*
<MODULE_CONTRACT>
<purpose>Facilitates version bumping based on commit classifications and confidence levels.</purpose>
<non-goals>
  <item>Do not handle raw commit parsing or classification logic.</item>
  <item>Do not manage version storage or retrieval mechanisms.</item>
  <item>Do not perform network operations or external API calls.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import semver from "semver";
import type { ClassifiedCommit, BumpResult } from "../types.ts";

// START_BLOCK_BUMPER
/**
 * [CL-BUMPER][calculateNextVersion][CONFIDENCE_CHECK] threshold={confidenceThreshold}
 * [CL-BUMPER][calculateNextVersion][MAJOR_GUARD] attempted={next}
 */
export function calculateNextVersion(
  current: string,
  commits: ClassifiedCommit[],
  confidenceThreshold: number,
): BumpResult {
  if (!semver.valid(current)) throw new Error(`Invalid current version: ${current}`);

  const [currentMajor] = current.split(".");

  const highConfBreaking = commits.filter(
    (c) => c.isBreaking && c.confidence >= confidenceThreshold,
  );
  const lowConfBreaking = commits.filter((c) => c.isBreaking && c.confidence < confidenceThreshold);

  console.log(
    `[CL-BUMPER][calculateNextVersion][CONFIDENCE_CHECK] threshold=${confidenceThreshold} high=${highConfBreaking.length} low=${lowConfBreaking.length}`,
  );

  if (lowConfBreaking.length > 0) {
    console.warn(
      `[CL-BUMPER][calculateNextVersion][LOW_CONFIDENCE] count=${lowConfBreaking.length} requires manual review.`,
    );
  }

  const hasFeature = commits.some((c) => c.type === "feat");
  const bump: semver.ReleaseType = hasFeature || highConfBreaking.length > 0 ? "minor" : "patch";

  const next = semver.inc(current, bump);
  if (!next) throw new Error(`semver.inc returned null for ${current} + ${bump}`);

  if (next.split(".")[0] !== currentMajor) {
    console.error(`[CL-BUMPER][calculateNextVersion][MAJOR_GUARD] attempted=${next} blocked=true`);
    throw new Error(`Major version guard violated: ${current} → ${next}`);
  }

  return {
    version: next,
    hasBreakingChanges: highConfBreaking.length > 0,
    requiresReview: lowConfBreaking.length > 0,
  };
}
// END_BLOCK_BUMPER
