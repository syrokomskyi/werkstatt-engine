/*
<MODULE_CONTRACT>
  <purpose>
RFC-1027: unit tests for remediation.hint.validate and remediation.catalog.generate
commands, plus aggregateRemediationHints helper.
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1027: initial tests for remediation commands and hint aggregation.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRemediationHintValidate } from "../remediation-hint-validate.ts";
import {
  runRemediationCatalogGenerate,
  type RemediationCatalogGenerateResult,
} from "../remediation-catalog-generate.ts";
import { buildActualState } from "../../runtime/reconciler.ts";
import type {
  CheckResult,
  KernelCommandInput,
  KernelRuntimeContext,
  KernelCommandDefinition,
} from "../../kernel/types.ts";
import type { ModuleExport } from "../../runtime/desired-state.ts";

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
    modulePath: "packages/werkstatt-engine/src/remediation/tests/remediation.test.ts",
    ...overrides,
  };
}

function makeContext(
  commands: KernelCommandDefinition[],
  workspaceRoot: string,
): KernelRuntimeContext {
  const mod: ModuleExport = {
    name: "test-module",
    version: "1.0.0",
    declarations: [],
    commands,
    pipelines: [],
  };
  const actualState = buildActualState([mod]);
  return {
    workspaceRoot,
    actualState,
    dryRun: false,
  } as unknown as KernelRuntimeContext;
}

const baseInput: KernelCommandInput = {
  argv: [],
  flags: {},
};

// ---------------------------------------------------------------------------
// remediation.hint.validate
// ---------------------------------------------------------------------------

test("hint.validate: warning mode — uncovered rule produces REMEDIATION-01 warning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rem-test-"));
  try {
    const commands = [
      makeCommand("content.links.validate", { contract: "content", rules: ["XLINK-01"] }),
    ];
    const context = makeContext(commands, dir);
    const result = await runRemediationHintValidate(
      { ...baseInput, flags: { mode: "warning" } },
      context,
    );
    const data = result.data as CheckResult;
    expect(result.exitCode).toBe(0);
    const remediation01 = data.diagnostics.filter((d) => d.ruleId === "REMEDIATION-01");
    expect(remediation01).toHaveLength(1);
    expect(remediation01[0].severity).toBe("warning");
    expect(remediation01[0].message).toContain("XLINK-01");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("hint.validate: strict mode — covered rule produces no REMEDIATION-01", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rem-test-"));
  try {
    const commands = [
      makeCommand("seo.meta.validate", {
        contract: "seo",
        rules: ["SEO-RUNTIME.CANONICAL-MISMATCH"],
      }),
    ];
    const context = makeContext(commands, dir);
    const result = await runRemediationHintValidate(
      { ...baseInput, flags: { mode: "strict" } },
      context,
    );
    const data = result.data as CheckResult;
    expect(result.exitCode).toBe(0);
    const remediation01 = data.diagnostics.filter((d) => d.ruleId === "REMEDIATION-01");
    expect(remediation01).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("hint.validate: strict mode — unknown rule is blocking error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rem-test-"));
  try {
    const commands = [
      makeCommand("custom.thing.validate", { contract: "custom", rules: ["CUSTOM-UNKNOWN"] }),
    ];
    const context = makeContext(commands, dir);
    const result = await runRemediationHintValidate(
      { ...baseInput, flags: { mode: "strict" } },
      context,
    );
    const data = result.data as CheckResult;
    expect(result.exitCode).toBe(1);
    expect(data.diagnostics[0].ruleId).toBe("REMEDIATION-01");
    expect(data.diagnostics[0].severity).toBe("error");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("hint.validate: REMEDIATION-02 for stale catalog entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rem-test-"));
  try {
    const commands: KernelCommandDefinition[] = [];
    const context = makeContext(commands, dir);
    const result = await runRemediationHintValidate(baseInput, context);
    expect(result.exitCode).toBe(0);
    const data = result.data as CheckResult;
    const staleWarnings = data.diagnostics.filter((d) => d.ruleId === "REMEDIATION-02");
    expect(staleWarnings.length).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// remediation.catalog.generate
// ---------------------------------------------------------------------------

test("catalog.generate: writes YAML with catalog entries and uncovered ruleIds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rem-cat-"));
  try {
    const commands = [
      makeCommand("content.links.validate", { contract: "content", rules: ["XLINK-01"] }),
      makeCommand("seo.meta.validate", {
        contract: "seo",
        rules: ["SEO-RUNTIME.CANONICAL-MISMATCH"],
      }),
    ];
    const context = makeContext(commands, dir);
    const result = await runRemediationCatalogGenerate(baseInput, context);
    const data = result.data as RemediationCatalogGenerateResult;
    expect(result.exitCode).toBe(0);
    expect(data.written).toBe(true);
    expect(data.entryCount).toBeGreaterThan(0);

    const outputPath = join(dir, "docs", "remediation-catalog.generated.yaml");
    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("GEN-FILES-01");
    expect(content).toContain("SEO-RUNTIME.CANONICAL-MISMATCH");
    expect(content).toContain("XLINK-01");
  } finally {
    await rm(dir, { recursive: true });
  }
});
