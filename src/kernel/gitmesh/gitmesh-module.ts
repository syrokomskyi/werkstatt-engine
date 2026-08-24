/*
<MODULE_CONTRACT>
<purpose>
RFC-0563: Kernel module registering gitmesh.sync, gitmesh.status, and
gitmesh.verify workspace commands. Each command is pull-only, workspace-scoped,
and not cacheable (they depend on external git/network state).
</purpose>
<non-goals>
  <item>Do not implement command handlers — those live in sync.ts, status.ts, verify.ts.</item>
  <item>Do not implement git operations — those live in git-ops.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — gitmesh module with sync, status, verify commands.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "../types.ts";

export const gitmeshModule: KernelModule = {
  name: "gitmesh",
  version: "0.1.0",

  async register(registry) {
    const { runGitMeshSync } = await import("./sync.ts");
    const { runGitMeshStatus } = await import("./status.ts");
    const { runGitMeshVerify } = await import("./verify.ts");

    registry.registerCommand({
      name: "gitmesh.sync",
      description:
        "RFC-0563: sync platform code from all configured remotes. Fetches from each " +
        "remote in werkstatt.gitmesh.json, converges on the latest signed commit by " +
        "committer timestamp, and advances HEAD via git merge --ff-only. Pull-only — " +
        "never pushes. Use --json for machine-readable output.",
      scope: "workspace",
      cacheable: false,
      requiresNetwork: true,
      reads: ["werkstatt.gitmesh.json", "werkstatt.identity.json"],
      writes: [".git/gitmesh.lock", ".git/gitmesh.last-sync"],
      execute: runGitMeshSync,
    });

    registry.registerCommand({
      name: "gitmesh.status",
      description:
        "RFC-0563: check sync status (am I up-to-date?). Local-only query — no network " +
        "I/O. Reports local SHA, remote SHA, behind/ahead counts, and last sync time. " +
        "Use --json for machine-readable output.",
      scope: "workspace",
      cacheable: false,
      reads: ["werkstatt.gitmesh.json", ".git/gitmesh.last-sync"],
      execute: runGitMeshStatus,
    });

    registry.registerCommand({
      name: "gitmesh.verify",
      description:
        "RFC-0563: verify all commit signatures in the local clone against the operator's " +
        "public key from werkstatt.identity.json. Incremental — only new commits since " +
        "last verification are checked. Reports unsigned commits, invalid signatures, " +
        "and total verified. Use --json for machine-readable output.",
      scope: "workspace",
      cacheable: false,
      reads: ["werkstatt.gitmesh.json", "werkstatt.identity.json", ".git/gitmesh.last-verified"],
      writes: [".git/gitmesh.last-verified"],
      execute: runGitMeshVerify,
    });
  },
};
