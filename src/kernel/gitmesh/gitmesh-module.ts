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
<KEY_DECISIONS>
  <item>Module registers commands only — gitmesh logic lives in the sibling handler modules.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — gitmesh module with sync, status, verify commands.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "../types.ts";
import type { ModuleExport } from "../../runtime/desired-state.ts";

export async function createGitmeshModule(): Promise<ModuleExport> {
const { runGitMeshSync } = await import("./sync.ts");
    const { runGitMeshStatus } = await import("./status.ts");
    const { runGitMeshVerify } = await import("./verify.ts");
  return {
  name: "gitmesh",
  version: "0.1.0",

    declarations: [],
  commands: [
    {
      name: "gitmesh.sync",
      modulePath: "packages/werkstatt-engine/src/kernel/gitmesh/gitmesh-module.ts",
      generates: [],
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
    },
    {
      name: "gitmesh.status",
      modulePath: "packages/werkstatt-engine/src/kernel/gitmesh/gitmesh-module.ts",
      description:
        "RFC-0563: check sync status (am I up-to-date?). Local-only query — no network " +
        "I/O. Reports local SHA, remote SHA, behind/ahead counts, and last sync time. " +
        "Use --json for machine-readable output.",
      scope: "workspace",
      cacheable: false,
      reads: ["werkstatt.gitmesh.json", ".git/gitmesh.last-sync"],
      execute: runGitMeshStatus,
    },
    {
      name: "gitmesh.verify",
      modulePath: "packages/werkstatt-engine/src/kernel/gitmesh/gitmesh-module.ts",
      generates: [],
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
    }
  ],
  pipelines: [

  ]};
}
;
