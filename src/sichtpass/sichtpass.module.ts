/*
<MODULE_CONTRACT>
<purpose>RFC-0947: sichtpass kernel module — registers sichtpass.generate command.</purpose>
<keywords>sichtpass, module, kernel, commands, registration</keywords>
<responsibilities>
  <item>Registers sichtpass.generate command with lazy-loaded handler.</item>
  <item>Declares correct scope, flags, reads/writes for the command.</item>
</responsibilities>
<non-goals>
  <item>Does not implement command handler — that lives in sichtpass-generate.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0947: initial sichtpass kernel module with sichtpass.generate command registration.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createSichtpassModule(): KernelModule {
  return {
    name: "sichtpass",
    version: "0.1.0",
    async register(registry) {
      const { runSichtpassGenerate } = await import("./sichtpass-generate.ts");

      registry.registerCommand({
        name: "sichtpass.generate",
        description:
          "RFC-0947: Generate a site-wide visibility snapshot with composite hash and deduplication. Appends sichtpass __site__ Bordbuch entry when composite hash changes.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        execute: runSichtpassGenerate,
      });
    },
  };
}
