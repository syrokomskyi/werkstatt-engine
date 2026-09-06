import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runValidatorInventoryGenerate } from "../validator-inventory.ts";
import { KernelRegistry } from "../registry.ts";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  KernelCommandDefinition,
} from "../types.ts";
import type { ModuleExport } from "../../runtime/desired-state.ts";

/*
<MODULE_CONTRACT>
<purpose>
RFC-0963: unit tests for validator.inventory.generate — fail-closed on
missing contract/rules, dry-run warnings, consolidation candidate detection,
and output shape verification.
</purpose>
</MODULE_CONTRACT>
*/

function makeCommand(
  name: string,
  overrides: Partial<KernelCommandDefinition> = {},
): KernelCommandDefinition {
  return {
    name,
    description: `Test command ${name}`,
    scope: "workspace",
    flags: {},
    execute: async () => ({ exitCode: 0, summary: "ok" }),
    modulePath: "packages/werkstatt-engine/src/kernel/tests/validator-inventory.test.ts",
    ...overrides,
  };
}

function makeContext(
  commands: KernelCommandDefinition[],
  workspaceRoot: string,
  pipelines: [string, { command: string }[]][] = [],
): KernelRuntimeContext {
  const registry = new KernelRegistry();
  const mod: ModuleExport = {
    name: "test-module",
    version: "1.0.0",
    declarations: [],
    commands,
    pipelines: pipelines.map(([name, steps]) => ({ name, steps })),
  };
  registry.populateFromModule(mod);
  return {
    workspaceRoot,
    actualState: registry,
    dryRun: false,
  } as unknown as KernelRuntimeContext;
}

const baseInput: KernelCommandInput = {
  argv: [],
  flags: {},
};

test("fail-closed when a validator is missing contract", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vi-test-"));
  try {
    const commands = [
      makeCommand("content.links.validate", { contract: "content", rules: ["LINK-01"] }),
      makeCommand("seo.meta.validate"),
    ];
    const context = makeContext(commands, dir);
    const result = await runValidatorInventoryGenerate(baseInput, context);
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("FAIL-CLOSED");
    expect(result.summary).toContain("seo.meta.validate");
    expect(result.data!.untaggedCount).toBe(1);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("fail-closed when a validator is missing rules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vi-test-"));
  try {
    const commands = [makeCommand("content.links.validate", { contract: "content" })];
    const context = makeContext(commands, dir);
    const result = await runValidatorInventoryGenerate(baseInput, context);
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("FAIL-CLOSED");
    expect(result.data!.untaggedCount).toBe(1);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("dry-run emits warnings instead of failing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vi-test-"));
  try {
    const commands = [
      makeCommand("content.links.validate", { contract: "content", rules: ["LINK-01"] }),
      makeCommand("seo.meta.validate"),
    ];
    const context = makeContext(commands, dir);
    const dryRunInput = { ...baseInput, flags: { "dry-run": true } };
    const result = await runValidatorInventoryGenerate(dryRunInput, context);
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("untagged");
    expect(result.summary).toContain("dry-run");
    expect(result.data!.untaggedCount).toBe(1);
    expect(result.data!.written).toBe(false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("contracts with >1 validator appear in consolidationCandidates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vi-test-"));
  try {
    const commands = [
      makeCommand("canonical.url.validate", { contract: "canonical-url", rules: ["CANON-01"] }),
      makeCommand("canonical.html-parity.validate", {
        contract: "canonical-url",
        rules: ["CANON-04"],
      }),
      makeCommand("mirroring.validate", { contract: "mirroring", rules: ["MIRROR-MISSING"] }),
    ];
    const context = makeContext(commands, dir);
    const result = await runValidatorInventoryGenerate(baseInput, context);
    expect(result.exitCode).toBe(0);
    expect(result.data!.consolidationCandidateCount).toBe(1);
    expect(result.data!.contractCount).toBe(2);
    expect(result.data!.validatorCount).toBe(3);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("non-validator commands are excluded from inventory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vi-test-"));
  try {
    const commands = [
      makeCommand("content.links.validate", { contract: "content", rules: ["LINK-01"] }),
      makeCommand("build.prepare", { contract: "build", rules: [] }),
      makeCommand("config.regenerate"),
    ];
    const context = makeContext(commands, dir);
    const result = await runValidatorInventoryGenerate(baseInput, context);
    expect(result.exitCode).toBe(0);
    expect(result.data!.validatorCount).toBe(1);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("pipeline phase is derived from registry pipelines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vi-test-"));
  try {
    const commands = [
      makeCommand("content.links.validate", { contract: "content", rules: ["LINK-01"] }),
    ];
    const pipelines: [string, { command: string }[]][] = [
      ["sites-check.author", [{ command: "content.links.validate" }]],
    ];
    const context = makeContext(commands, dir, pipelines);
    const result = await runValidatorInventoryGenerate(baseInput, context);
    expect(result.exitCode).toBe(0);
    expect(result.data!.contractCount).toBe(1);
  } finally {
    await rm(dir, { recursive: true });
  }
});
