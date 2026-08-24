/*
<MODULE_CONTRACT>
<purpose>Facilitates the registration of semantic layer validation commands per RFC-0042.</purpose>
<non-goals>
  <item>Do not implement content generation — validation only.</item>
  <item>Do not manage semantic builder logic — only check outputs.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0042: Created semantic module with page validation command.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "../types.ts";

export const semanticModule: KernelModule = {
  name: "semantic",
  version: "0.1.0",

  async register(registry) {
    const { runSemanticPageValidate } = await import("./handlers.ts");
    // ── semantic.page.validate ─────────────────────────────────────────────────
    registry.registerCommand({
      name: "semantic.page.validate",
      description:
        "[RFC-0042] Validate that semantic outputs (llms.txt, pages) do not contain " +
        "NEED_THIS_* markers indicating missing required content. " +
        "Use --strict to fail even in development. " +
        "Use --path to specify custom directory (default: dist/llms). " +
        "Use --json for machine-readable output.",
      scope: "app",
      reads: ["<app>/dist/llms/**"],
      execute: runSemanticPageValidate,
    });
  },
};
