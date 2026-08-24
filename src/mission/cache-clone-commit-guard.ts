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
  <item>Initial cache-clone commit guard — blocks direct git commit in cache clones.</item>
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
