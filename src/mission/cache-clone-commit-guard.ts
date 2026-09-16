/*
<MODULE_CONTRACT>
  <purpose>Cache-clone commit guard — prevents direct git commit in Sternsystem cache clones.
  Installed as part of the combined pre-commit hook alongside the bordbuch integrity guard.
  Blocks raw git commit unless MISSION_GIT_COMMIT=1 env var is set (used by mission.git.commit).</purpose>
  <non-goals>
    <item>Does not install hooks — bordbuch-hook.ts owns hook installation and combines this guard.</item>
    <item>Does not block file edits — only blocks git commit.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export const CACHE_CLONE_COMMIT_GUARD_SCRIPT = `# Cache-clone commit guard (RFC-0821)
# Blocks direct git commit in Sternsystem cache clones.
# mission.git.commit sets MISSION_GIT_COMMIT=1 to bypass this guard.
if [ -z "\${MISSION_GIT_COMMIT:-}" ]; then
  echo "ERROR: Direct git commit blocked in Sternsystem cache clone." >&2
  echo "Use mission.git.commit instead:" >&2
  echo "  pnpm exec werkstatt run mission.git.commit --mission=<missionId> --message=\\"<message>\\"" >&2
  exit 1
fi
`;
