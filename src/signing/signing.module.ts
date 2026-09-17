/*
<MODULE_CONTRACT>
<purpose>signing.module — signing kernel module registering the signing.key.generate command (RFC-0921).</purpose>


<non-goals>
  <item>Does not implement command handlers — those live in signing-commands.ts.</item>
  <item>Does not register domain-specific signing commands (nachweis.sign, integrity.sign) — those belong to their respective modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0921: initial signing kernel module with signing.key.generate registration.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

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
