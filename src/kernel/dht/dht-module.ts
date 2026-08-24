/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: Kernel module registering DHT workspace commands. All commands are
workspace-scoped and not cacheable (they depend on external network state and
workshop-local files). Commands are added incrementally as they are implemented.
</purpose>
<non-goals>
  <item>Do not implement command handlers — those live in their own files.</item>
  <item>Do not implement DHT routing — that lives in node.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial implementation — dht module with dht.node.init command.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "../types.ts";

export const dhtModule: KernelModule = {
  name: "dht",
  version: "0.1.0",

  async register(registry) {
    const { runDhtNodeInit } = await import("./init.ts");
    const { runDhtLookup } = await import("./lookup.ts");
    const { runDhtRegister } = await import("./register.ts");
    const { runDhtCapacityPublish } = await import("./capacity.ts");
    const { runDhtPlacement } = await import("./placement.ts");
    const { runDhtStatus } = await import("./status.ts");

    registry.registerCommand({
      name: "dht.node.init",
      description:
        "RFC-0565: initialize DHT configuration. Creates werkstatt.dht.json with " +
        "bind address, bootstrap nodes, replication factor, and timeout parameters. " +
        "Use --bind <host:port> to specify the bind address. Use --bootstrap <host:port> " +
        "to specify a bootstrap node (can be repeated). Use --json for machine-readable output.",
      scope: "workspace",
      cacheable: false,
      reads: ["werkstatt.identity.json"],
      writes: ["werkstatt.dht.json"],
      execute: runDhtNodeInit,
    });

    registry.registerCommand({
      name: "dht.lookup",
      description:
        "RFC-0565: resolve a site id to its DHT entry. Queries the DHT (or local " +
        "cache if fresh) and validates the entry signature. Routes around dead " +
        "workshops detected by SWIM. Use --site-id <id> to specify the site. " +
        "Use --force to bypass cache. Use --json for machine-readable output.",
      scope: "workspace",
      cacheable: false,
      reads: [
        "werkstatt.dht.json",
        "werkstatt.dht.cache.json",
        "werkstatt.identity.json",
        "werkstatt.swim.json",
        "werkstatt.genome.log",
      ],
      writes: ["werkstatt.dht.cache.json"],
      execute: runDhtLookup,
    });

    registry.registerCommand({
      name: "dht.register",
      description:
        "RFC-0565: publish a local registry entry to the DHT. Signs the entry with " +
        "the operator's Ed25519 keypair. Uses LWW on lastUpdated for conflict resolution. " +
        "Required flags: --site-id <id>, --owner <did:web>, --endpoint <host:port>. " +
        "Optional: --mirrors <host:port> (can be repeated). Use --json for output.",
      scope: "workspace",
      cacheable: false,
      reads: ["werkstatt.dht.json", "werkstatt.identity.json"],
      writes: ["werkstatt.dht.cache.json"],
      execute: runDhtRegister,
    });

    registry.registerCommand({
      name: "dht.capacity.publish",
      description:
        "RFC-0565: publish workshop capacity to the DHT for placement decisions. " +
        "Signs the capacity entry with the operator's Ed25519 keypair. " +
        "Required: --workshop-id <id>, --available-slots <n>, --endpoint <host:port>. " +
        "Optional: --storage-limit-mb <n>, --bandwidth-limit-mbps <n>. Use --json for output.",
      scope: "workspace",
      cacheable: false,
      reads: ["werkstatt.dht.json", "werkstatt.identity.json"],
      writes: [],
      execute: runDhtCapacityPublish,
    });

    registry.registerCommand({
      name: "dht.placement",
      description:
        "RFC-0565: determine the best workshop for placing a site by querying DHT " +
        "capacity entries. Uses least-loaded strategy by default. " +
        "Required: --site-id <id>, --workshops <id1,id2,...> (or repeated). " +
        "Optional: --strategy <least-loaded|nearest|owner-preference>. Use --json for output.",
      scope: "workspace",
      cacheable: false,
      reads: ["werkstatt.dht.json", "werkstatt.identity.json", "werkstatt.swim.json"],
      writes: [],
      execute: runDhtPlacement,
    });

    registry.registerCommand({
      name: "dht.status",
      description:
        "RFC-0565: report local DHT node status including config, cache entries, " +
        "identity bootstrap state, and SWIM configuration. Local-only query — no network I/O. " +
        "Use --json for machine-readable output.",
      scope: "workspace",
      cacheable: false,
      reads: [
        "werkstatt.dht.json",
        "werkstatt.dht.cache.json",
        "werkstatt.identity.json",
        "werkstatt.swim.json",
      ],
      writes: [],
      execute: runDhtStatus,
    });
  },
};
