/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/command-manifest.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Does not register command.manifest.validate — that command lives in @warpgogol/site-kernel-checks so it can cross-check GENERATOR_OWNERSHIP_MAP (CMD-MAN-03) without a reverse package dependency.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0266: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "./types.ts";

export const commandManifestModule: KernelModule = {
  name: "command-manifest",
  version: "0.1.0",

  async register(registry) {
    const { runCommandManifestGenerate } = await import("./command-manifest.ts");
    registry.registerCommand({
      name: "command.manifest.generate",
      description:
        "Aggregate every registered command's metadata (flags, IO globs, mutability, timeouts, pipeline " +
        "membership) into docs/command-manifest.generated.yaml — the single machine-readable command " +
        "description. Use --dry-run to preview without writing (RFC-0266).",
      scope: "workspace",
      mutatesState: true,
      writes: ["docs/command-manifest.generated.yaml"],
      cacheable: false,
      flags: {
        "dry-run": {
          kind: "boolean",
          description: "Preview the manifest without writing the file.",
        },
      },
      execute: runCommandManifestGenerate,
    });
  },
};
