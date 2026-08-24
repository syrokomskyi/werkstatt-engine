/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/commit-message.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not implement lint logic here — see commit-message-lint.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0265: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "./types.ts";

export const commitMessageModule: KernelModule = {
  name: "commit-message",
  version: "0.1.0",

  async register(registry) {
    const { runCommitMessageLint } = await import("./commit-message-lint.ts");
    registry.registerCommand({
      name: "commit.message.lint",
      description:
        "Validate commit message hygiene for a git range (default: origin/main..HEAD): " +
        "subject length, conventional-commit shape, narration/markdown pollution, and " +
        "RFC-id reference for packages/os/** or docs/rfcs/** changes (RFC-0265). " +
        "Pass --range <rev-range> to override.",
      scope: "workspace",
      cacheable: false,
      flags: {
        range: {
          kind: "string",
          description: "git rev-range to lint (default: origin/main..HEAD).",
        },
      },
      execute: runCommitMessageLint,
    });
  },
};
