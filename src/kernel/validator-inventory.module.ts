/*
<MODULE_CONTRACT>
<purpose>
RFC-0963: registers the validator.inventory.generate command, which emits
docs/validator-inventory.generated.yaml and enforces fail-closed on missing
contract/rules tags.
</purpose>
<non-goals>
  <item>Do not implement inventory logic here — see validator-inventory.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0963: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "./types.ts";

export const validatorInventoryModule: KernelModule = {
  name: "validator-inventory",
  version: "0.1.0",

  async register(registry) {
    const { runValidatorInventoryGenerate } = await import("./validator-inventory.ts");
    registry.registerCommand({
      name: "validator.inventory.generate",
      modulePath: "packages/werkstatt-engine/src/kernel/validator-inventory.module.ts",
      description:
        "Emit docs/validator-inventory.generated.yaml mapping contracts to validators, rules, pipeline phase, and p95 timing (RFC-0963). " +
        "Fail-closed on missing contract/rules tags. Use --dry-run for warning-only mode during migration.",
      scope: "workspace",
      mutatesState: true,
      writes: ["docs/validator-inventory.generated.yaml"],
      cacheable: false,
      generates: [
        {
          path: "docs/validator-inventory.generated.yaml",
          phase: "build.post",
        },
      ],
      flags: {
        "dry-run": {
          kind: "boolean",
          description: "Emit warnings instead of failing on untagged validators.",
        },
      },
      execute: runValidatorInventoryGenerate,
    });
  },
};
