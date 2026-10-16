/*
<MODULE_CONTRACT>
<purpose>
RFC-0903: Unit tests for werkstatt.commands.validate static analysis.
Covers CMD-OUTPUT-01/02/03 rules, helper-exempt returns, and --mode flag.
</purpose>
<keywords>test, commands-validate, RFC-0903, DNA-82</keywords>
<non-goals>
  <item>Does not test against the real codebase — uses synthetic test fixtures.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0903: initial unit tests for commands-validate.</item>
  <item>ADR-0105 fo-review: regression test for the isHandlerFile detector gap —
        a self-describing KernelCommandDefinition file with a multi-line
        `import type` must be scanned, not skipped.</item>
  <item>RFC-1231: step 1 — rename supportsAllSites to acceptsAllFlag

Mechanical sweep: the field only ever gated --all argv acceptance; fan-out
follows the parsed selector. Guard renamed assertAllSitesAllowed ->
assertAllFlagAccepted, message updated. 417 declaration sites + type
surfaces (KernelCommandMetadata, ForgeCommandMetadata) in one atomic pass.</item>
  <item>RFC-1248: VITE-CLIENT-DEP-02 lazy-import gate + SCAN-02 validator reads-root existence check (RFC-1248)</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCommandsValidate } from "../plugin/commands-validate.ts";

function makeTempWorkspace(): string {
  return mkdtempSync(join(process.cwd(), "tmp-commands-validate-"));
}

function writeHandlerFile(workspaceRoot: string, relPath: string, content: string): void {
  const fullPath = join(workspaceRoot, relPath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content, "utf8");
}

const HANDLER_HEADER = `import type { KernelCommandResult } from "@warpgogol/werkstatt-engine/kernel";
`;

describe("runCommandsValidate", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeTempWorkspace();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("CMD-OUTPUT-01: flags return missing exitCode", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return {
    summary: "[test.cmd] OK",
  };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    expect(result.exitCode).toBe(1);
    const violations = result.data?.diagnostics ?? [];
    const cmd01 = violations.find((d) => d.ruleId === "CMD-OUTPUT-01");
    expect(cmd01).toBeDefined();
    expect(cmd01?.file).toBe("packages/werkstatt-engine/src/test-cmd.ts");
  });

  it("CMD-OUTPUT-02: flags return missing summary", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return {
    exitCode: 0,
  };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    expect(result.exitCode).toBe(1);
    const violations = result.data?.diagnostics ?? [];
    const cmd02 = violations.find((d) => d.ruleId === "CMD-OUTPUT-02");
    expect(cmd02).toBeDefined();
  });

  it("CMD-OUTPUT-02: flags summary without [command.name] prefix", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return {
    exitCode: 0,
    summary: "OK",
  };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    expect(result.exitCode).toBe(1);
    const violations = result.data?.diagnostics ?? [];
    const cmd02 = violations.find(
      (d) => d.ruleId === "CMD-OUTPUT-02" && d.message.includes("prefix"),
    );
    expect(cmd02).toBeDefined();
  });

  it("CMD-OUTPUT-03: flags exitCode: 1 with no nextSteps", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return {
    exitCode: 1,
    summary: "[test.cmd] failed",
  };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    expect(result.exitCode).toBe(1);
    const violations = result.data?.diagnostics ?? [];
    const cmd03 = violations.find((d) => d.ruleId === "CMD-OUTPUT-03");
    expect(cmd03).toBeDefined();
  });

  it("CMD-OUTPUT-03: flags exitCode: 1 with empty nextSteps: []", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return {
    exitCode: 1,
    summary: "[test.cmd] failed",
    nextSteps: [],
  };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    expect(result.exitCode).toBe(1);
    const violations = result.data?.diagnostics ?? [];
    const cmd03 = violations.find((d) => d.ruleId === "CMD-OUTPUT-03");
    expect(cmd03).toBeDefined();
  });

  it("helper-exempt: passResult returns are not flagged", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return passResult("test.cmd");
}
function passResult(command: string): KernelCommandResult {
  return { exitCode: 0, summary: \`[\${command}] OK\` };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    const violations = result.data?.diagnostics ?? [];
    expect(violations.length).toBe(0);
  });

  it("helper-exempt: failResult returns are not flagged", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return failResult("test.cmd", ["error 1"]);
}
function failResult(command: string, violations: string[]): KernelCommandResult {
  return { exitCode: 1, summary: \`[\${command}] \${violations.length} violation\${violations.length === 1 ? "" : "s"}\`, nextSteps: [{ action: "fix", kind: "required" }] };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    const violations = result.data?.diagnostics ?? [];
    expect(violations.length).toBe(0);
  });

  it("helper-exempt: diagnosticsResult returns are not flagged", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return diagnosticsResult("test.cmd", []);
}
function diagnosticsResult(command: string, diags: unknown[]): KernelCommandResult {
  return { exitCode: 0, summary: \`[\${command}] 0 error(s), 0 warning(s)\` };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    const violations = result.data?.diagnostics ?? [];
    expect(violations.length).toBe(0);
  });

  it("helper-exempt: buildAuditResult returns are not flagged", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return buildAuditResult({ command: "test.cmd", findings: [] });
}
function buildAuditResult(params: { command: string; findings: unknown[] }): KernelCommandResult {
  return { exitCode: 0, summary: \`[\${params.command}] audit OK\` };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    const violations = result.data?.diagnostics ?? [];
    expect(violations.length).toBe(0);
  });

  it("--mode=warning: violations are warnings, exitCode is 0", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return {
    exitCode: 1,
    summary: "[test.cmd] failed",
  };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "warning");
    expect(result.exitCode).toBe(0);
    const violations = result.data?.diagnostics ?? [];
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((d) => d.severity === "warning")).toBe(true);
  });

  it("--mode=error: violations are errors, exitCode is 1", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return {
    exitCode: 1,
    summary: "[test.cmd] failed",
  };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    expect(result.exitCode).toBe(1);
    const violations = result.data?.diagnostics ?? [];
    expect(violations.every((d) => d.severity === "error")).toBe(true);
  });

  it("compliant success return: no violations", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return {
    exitCode: 0,
    summary: "[test.cmd] OK",
  };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    const violations = result.data?.diagnostics ?? [];
    expect(violations.length).toBe(0);
    expect(result.exitCode).toBe(0);
  });

  it("compliant failure return with nextSteps: no violations", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return {
    exitCode: 1,
    summary: "[test.cmd] failed",
    nextSteps: [{ action: "Fix the error", kind: "required" }],
  };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    const violations = result.data?.diagnostics ?? [];
    expect(violations.length).toBe(0);
  });

  it("summary is [command.name]-prefixed on result", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return { exitCode: 0, summary: "[test.cmd] OK" };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    expect(result.summary).toBe(
      "[werkstatt.commands.validate] 0 violations across 1 files scanned",
    );
  });

  it("nextSteps present on failure result", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export async function execute(): Promise<KernelCommandResult> {
  return { exitCode: 1, summary: "failed" };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    expect(result.nextSteps).toBeDefined();
    expect(result.nextSteps?.length).toBeGreaterThan(0);
    expect(result.nextSteps?.[0]?.kind).toBe("required");
  });

  it("detector: self-describing KernelCommandDefinition file with multi-line import type is scanned (ADR-0105 gap)", async () => {
    // Before the fix, isHandlerFile required a single-line `import.*KernelCommandResult`
    // or a registerCommand/ALL_COMMANDS/moduleLoaders call — a self-describing
    // definition file like this one escaped the gate entirely.
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/checks/test-def.ts",
      `import type {
  KernelCommandDefinition,
  KernelCommandResult,
} from "@warpgogol/werkstatt-engine/kernel";

export const testDefCommand: KernelCommandDefinition = {
  name: "test.def",
  mutatesState: false,
  contract: "dist",
  rules: ["TEST-DEF-01"],
  modulePath: "packages/werkstatt-engine/src/checks/test-def.ts",
  description: "test",
  scope: "app",
  flags: {},
  acceptsAllFlag: true,
  reads: [],
  cacheable: true,
  modulePaths: ["test-def.ts"],
  async execute(): Promise<KernelCommandResult> {
    return { exitCode: 1 };
  },
};
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    const violations = result.data?.diagnostics ?? [];
    expect(violations.length).toBeGreaterThan(0);
    expect(
      violations.some((d) => d.file === "packages/werkstatt-engine/src/checks/test-def.ts"),
    ).toBe(true);
  });

  it("non-command-result returns are not flagged (module descriptors, internal objects)", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/test-cmd.ts",
      `${HANDLER_HEADER}
export function createModule() {
  return {
    name: "test-module",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "test.cmd",
        modulePath: "test",
        description: "test",
        scope: "workspace",
        flags: {},
        reads: [],
        cacheable: false,
        async execute(): Promise<KernelCommandResult> {
          return { exitCode: 0, summary: "[test.cmd] OK" };
        },
      },
    ],
    pipelines: [],
  };
}

function helper(): { found: boolean; line: number } {
  return { found: false, line: 0 };
}
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    const violations = result.data?.diagnostics ?? [];
    expect(violations.length).toBe(0);
  });

  it("RFC-1304 AC-5: a suspect file in the generator corpus emits CMDGEN-04", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-site/src/checks/suspect-file.ts",
      `import type { KernelCommandDefinition } from "@warpgogol/werkstatt-engine/kernel";
export const looksLikeDef: KernelCommandDefinition = buildCommand();
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    const violations = result.data?.diagnostics ?? [];
    expect(violations.some((d) => d.ruleId === "CMDGEN-04")).toBe(true);
  });

  it("RFC-1304 AC-5: an invisible codepoint emits CMDGEN-05 with codepoint name and offset", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/nul-file.ts",
      "export const x = 1;\n\x00export const y = 2;\n",
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    const violations = result.data?.diagnostics ?? [];
    const hit = violations.find((d) => d.ruleId === "CMDGEN-05");
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("NUL");
    expect(hit!.message).toContain("offset 20");
  });

  it("RFC-1304: // cmdgen-ignore suppresses CMDGEN-04, and non-site trees never fire it", async () => {
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-site/src/checks/ignored.ts",
      `// cmdgen-ignore — authoring template, not a command source
import type { KernelCommandDefinition } from "@warpgogol/werkstatt-engine/kernel";
export const looksLikeDef: KernelCommandDefinition = buildCommand();
`,
    );
    // Engine-side def-shaped file — registerCommand-style modules are the
    // engine's own pattern and must not trip the site-corpus suspect net.
    writeHandlerFile(
      workspaceRoot,
      "packages/werkstatt-engine/src/def-shaped.ts",
      `import type { KernelCommandDefinition } from "@warpgogol/werkstatt-engine/kernel";
export const looksLikeDef: KernelCommandDefinition = buildCommand();
`,
    );

    const result = await runCommandsValidate(workspaceRoot, "error");
    const violations = result.data?.diagnostics ?? [];
    expect(violations.some((d) => d.ruleId === "CMDGEN-04")).toBe(false);
  });
});
