/*
<MODULE_CONTRACT>
<purpose>RFC-0921: Signing kernel module — registers signing.key.generate command.</purpose>
<keywords>signing, module, kernel, command, registration</keywords>
<responsibilities>
  <item>Registers signing.key.generate for Ed25519 keypair generation.</item>
  <item>Uses dynamic imports for lazy loading (same pattern as nachweis.module.ts).</item>
</responsibilities>
<non-goals>
  <item>Does not implement command handlers — those live in signing-commands.ts.</item>
  <item>Does not register domain-specific signing commands (nachweis.sign, integrity.sign) — those belong to their respective modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0921: initial signing kernel module with signing.key.generate registration.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createSigningModule(): Promise<ModuleExport> {
  const { runSigningKeyGenerate } = await import("./signing-commands.ts");
  return {
    name: "signing",
    version: "0.1.0",
      declarations: [],
  commands: [
    {
        name: "signing.key.generate",
        modulePath: "packages/werkstatt-engine/src/signing/signing.module.ts",
        description:
          "RFC-0921: Generate an Ed25519 keypair and save to disk. Supports hex and PEM encodings.",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        writes: ["<output-dir>/**"],
        generates: [],
        flags: {
          "output-dir": {
            kind: "string",
            required: true,
            description: "Directory to write the keypair files.",
          },
          encoding: {
            kind: "string",
            description: 'Key encoding: "hex" (default) or "pem".',
          },
          force: {
            kind: "boolean",
            description: "Overwrite existing key files.",
          },
        },
        execute: runSigningKeyGenerate,
      }
  ],
  pipelines: [

  ]};
}
