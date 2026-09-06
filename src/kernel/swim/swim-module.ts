/*
<MODULE_CONTRACT>
<purpose>
RFC-0564: Kernel module registering swim.join, swim.leave, swim.members, and
swim.status workspace commands. All commands are workspace-scoped and not
cacheable (they depend on external network state and workshop-local files).
</purpose>
<non-goals>
  <item>Do not implement command handlers — those live in handlers.ts.</item>
  <item>Do not implement genome log I/O — that lives in genome-log.ts.</item>
  <item>Do not implement config loading — that lives in config.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0564: initial implementation — swim module with join, leave, members, status commands.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "../types.ts";
import type { ModuleExport } from "../../runtime/desired-state.ts";

export async function createSwimModule(): Promise<ModuleExport> {
const { runSwimJoin, runSwimLeave, runSwimMembers, runSwimStatus } =
      await import("./handlers.ts");
  return {
  name: "swim",
  version: "0.1.0",

    declarations: [],
  commands: [
    {
      name: "swim.join",
      modulePath: "packages/werkstatt-engine/src/kernel/swim/swim-module.ts",
      generates: [],
      description:
        "RFC-0564: join a SWIM workshop network. Probes the seed node via UDP, " +
        "creates werkstatt.swim.json if missing (generating UUID v7 for workshopId), " +
        "records alive event to the CRDT genome log with Ed25519 signature. " +
        "Ephemeral — SWIM instance is destroyed when command exits. " +
        "Use --seed <host:port> to specify the seed node. Use --json for machine-readable output.",
      scope: "workspace",
      cacheable: false,
      requiresNetwork: true,
      reads: ["werkstatt.identity.json"],
      writes: ["werkstatt.swim.json", "werkstatt.genome.log"],
      execute: runSwimJoin,
    },
    {
      name: "swim.leave",
      modulePath: "packages/werkstatt-engine/src/kernel/swim/swim-module.ts",
      generates: [],
      description:
        "RFC-0564: leave a SWIM workshop network. Records left event to the CRDT " +
        "genome log with Ed25519 signature. Ephemeral — no long-running daemon to shut down. " +
        "Use --json for machine-readable output.",
      scope: "workspace",
      cacheable: false,
      reads: ["werkstatt.swim.json", "werkstatt.identity.json"],
      writes: ["werkstatt.genome.log"],
      execute: runSwimLeave,
    },
    {
      name: "swim.members",
      modulePath: "packages/werkstatt-engine/src/kernel/swim/swim-module.ts",
      description:
        "RFC-0564: list workshop members from the CRDT genome log. Local-only query — " +
        "no network I/O. Reads werkstatt.genome.log, verifies signatures, derives membership " +
        "view (latest event per workshop wins). Use --json for machine-readable output.",
      scope: "workspace",
      cacheable: false,
      reads: ["werkstatt.swim.json", "werkstatt.genome.log", "werkstatt.identity.json"],
      execute: runSwimMembers,
    },
    {
      name: "swim.status",
      modulePath: "packages/werkstatt-engine/src/kernel/swim/swim-module.ts",
      description:
        "RFC-0564: check local SWIM status. Reports configuration state, workshopId, " +
        "genome log size (warns at 10MB), membership view, and any skipped entries. " +
        "Local-only query — no network I/O. Use --json for machine-readable output.",
      scope: "workspace",
      cacheable: false,
      reads: ["werkstatt.swim.json", "werkstatt.genome.log", "werkstatt.identity.json"],
      execute: runSwimStatus,
    }
  ],
  pipelines: [

  ]};
}
;
