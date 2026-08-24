/*
<MODULE_CONTRACT>
<purpose>
RFC-0903: Static analysis validator for kernel command output consistency.
Scans .ts files in packages/werkstatt/src/, packages/werkstatt-site/src/, and
packages/werkstatt-shared/src/ for command handler return statements and
enforces DNA-82: explicit exitCode, [command.name]-prefixed summary, and
nextSteps on failure paths.
</purpose>
<keywords>validate, commands, RFC-0903, DNA-82, static-analysis, exitCode, summary, nextSteps</keywords>
<non-goals>
  <item>Does not execute commands — pure static analysis of return statements.</item>
  <item>Does not modify files — produces diagnostics only.</item>
  <item>Does not add itself to PACKAGES_CHECK_PIPELINE — gated adoption per RFC-0903.</item>
  <item>Does not detect dynamically constructed return objects (spread, conditional assignment) — regex-based scanning catches direct object literal returns only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0903: initial implementation of werkstatt.commands.validate static analysis.</item>
</CHANGE_SUMMARY>
*/

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Diagnostic, KernelCommandResult, KernelNextStep } from "../kernel/types.ts";

export interface CommandsValidateResult {
  command: string;
  status: "pass" | "fail";
  diagnostics: Diagnostic[];
  scannedFiles: number;
}

const COMMAND_NAME = "werkstatt.commands.validate";

const EXCLUDE_DIRS = new Set(["node_modules", "tests", "tests-handoff", "dist", "templates", "os"]);
const EXCLUDE_SUFFIXES = [".test.ts", ".spec.ts"];

const HELPER_FUNCTIONS = new Set([
  "passResult",
  "failResult",
  "diagnosticsResult",
  "resultFromViolations",
  "buildAuditResult",
]);

const FILE_DETECTION_PATTERNS = [
  /registry\.registerCommand\s*\(/,
  /\bALL_COMMANDS\b/,
  /\bmoduleLoaders\b/,
];

const RETURN_OBJECT_PATTERN = /return\s*\{/g;
const EXIT_CODE_PATTERN = /exitCode\s*:\s*(?:(\d+)|(\w+))/;
const SUMMARY_KEY_PATTERN = /summary\s*(?::|,|})/;
const SUMMARY_PATTERN = /summary\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/;
const NEXT_STEPS_PATTERN = /nextSteps\s*:/;
const HELPER_RETURN_PATTERN = new RegExp(
  `return\\s+(?:await\\s+)?(${[...HELPER_FUNCTIONS].join("|")})\\s*\\(`,
);

function hasCommandResultKeys(returnText: string): boolean {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < returnText.length; i++) {
    const ch = returnText[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 1 && ch === ":") {
      let j = i - 1;
      while (j >= 0 && /\s/.test(returnText[j])) j--;
      const keyEnd = j + 1;
      if (j >= 0 && (returnText[j] === '"' || returnText[j] === "'")) {
        const quote = returnText[j];
        j--;
        while (j >= 0 && returnText[j] !== quote) j--;
        const key = returnText.slice(j + 1, keyEnd - 1);
        if (key === "exitCode" || key === "summary") return true;
        continue;
      }
      while (j >= 0 && /[\w$-]/.test(returnText[j])) j--;
      const key = returnText.slice(j + 1, keyEnd);
      if (key === "exitCode" || key === "summary") return true;
    }
  }
  return false;
}

function shouldExcludeFile(fileName: string): boolean {
  return EXCLUDE_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

function isHandlerFile(content: string): boolean {
  if (/import.*KernelCommandResult|import.*KernelNextStep/.test(content)) return true;
  for (const pattern of FILE_DETECTION_PATTERNS) {
    if (pattern.test(content)) return true;
  }
  return false;
}

interface ReturnViolation {
  exitCodePresent: boolean;
  exitCodeValue: string | null;
  exitCodeIsLiteral: boolean;
  summaryPresent: boolean;
  summaryValue: string | null;
  nextStepsPresent: boolean;
  isHelperReturn: boolean;
}

function findReturnStatements(content: string): { startIdx: number; line: number }[] {
  const results: { startIdx: number; line: number }[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(RETURN_OBJECT_PATTERN.source, "g");
  while ((match = pattern.exec(content)) !== null) {
    const line = content.slice(0, match.index).split("\n").length;
    results.push({ startIdx: match.index, line });
  }
  return results;
}

function extractReturnObject(content: string, startIdx: number): string {
  let depth = 0;
  let endIdx = startIdx;
  let inString: string | null = null;
  for (let i = startIdx; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  return content.slice(startIdx, endIdx);
}

function analyzeReturnObject(
  returnText: string,
  fullContent: string,
  returnStartIdx: number,
): ReturnViolation {
  const helperMatch = HELPER_RETURN_PATTERN.exec(
    fullContent.slice(returnStartIdx, returnStartIdx + 200),
  );
  if (helperMatch) {
    return {
      exitCodePresent: true,
      exitCodeValue: null,
      exitCodeIsLiteral: false,
      summaryPresent: true,
      summaryValue: null,
      nextStepsPresent: true,
      isHelperReturn: true,
    };
  }

  if (!hasCommandResultKeys(returnText)) {
    return {
      exitCodePresent: true,
      exitCodeValue: null,
      exitCodeIsLiteral: false,
      summaryPresent: true,
      summaryValue: null,
      nextStepsPresent: true,
      isHelperReturn: true,
    };
  }

  const exitCodeMatch = EXIT_CODE_PATTERN.exec(returnText);
  const summaryKeyMatch = SUMMARY_KEY_PATTERN.test(returnText);
  const summaryMatch = SUMMARY_PATTERN.exec(returnText);
  const nextStepsMatch = NEXT_STEPS_PATTERN.test(returnText);

  const exitCodeValue = exitCodeMatch?.[1] ?? exitCodeMatch?.[2] ?? null;
  const exitCodeIsLiteral = exitCodeMatch?.[1] !== undefined;

  let summaryValue = summaryMatch?.[1] ?? summaryMatch?.[2] ?? summaryMatch?.[3] ?? null;
  if (summaryValue === null && summaryKeyMatch) {
    const ternaryMatch = returnText.match(/summary\s*:\s*[^"'`\n]*?\?\s*`([^`]*)`/s);
    if (ternaryMatch) {
      summaryValue = ternaryMatch[1];
    } else {
      const anyStringMatch = returnText.match(/summary\s*:\s*[\s\S]*?`([^`]*)`/);
      if (anyStringMatch) {
        summaryValue = anyStringMatch[1];
      }
    }
  }

  return {
    exitCodePresent: exitCodeMatch !== null,
    exitCodeValue,
    exitCodeIsLiteral,
    summaryPresent: summaryKeyMatch,
    summaryValue,
    nextStepsPresent: nextStepsMatch,
    isHelperReturn: false,
  };
}

function inferCommandName(filePath: string, workspaceRoot: string): string {
  const relPath = relative(workspaceRoot, filePath);
  const parts = relPath.replace(/\.ts$/, "").split("/");
  const fileName = parts[parts.length - 1];
  return fileName.replace(/-/g, ".");
}

async function scanFile(filePath: string, workspaceRoot: string): Promise<Diagnostic[]> {
  const content = await readFile(filePath, "utf8").catch(() => "");
  if (!content || !isHandlerFile(content)) return [];

  const diagnostics: Diagnostic[] = [];
  const commandName = inferCommandName(filePath, workspaceRoot);
  const relPath = relative(workspaceRoot, filePath);

  const returnStarts = findReturnStatements(content);
  for (const { startIdx, line } of returnStarts) {
    const returnText = extractReturnObject(content, startIdx);
    if (!returnText || returnText === "{}") continue;

    const violation = analyzeReturnObject(returnText, content, startIdx);
    if (violation.isHelperReturn) continue;

    if (!violation.exitCodePresent) {
      diagnostics.push({
        ruleId: "CMD-OUTPUT-01",
        severity: "error",
        message: `Return path missing explicit exitCode in ${relPath}:${line}`,
        file: relPath,
        line,
        fixHint: `Add exitCode: 0 (success) or exitCode: 1 (failure) to the return object.`,
      });
    }

    if (!violation.summaryPresent) {
      diagnostics.push({
        ruleId: "CMD-OUTPUT-02",
        severity: "error",
        message: `Return path missing summary in ${relPath}:${line}`,
        file: relPath,
        line,
        fixHint: `Add summary: "[${commandName}] <description>" to the return object.`,
      });
    } else if (violation.summaryValue && !violation.summaryValue.startsWith("[")) {
      diagnostics.push({
        ruleId: "CMD-OUTPUT-02",
        severity: "error",
        message: `Summary does not start with [command.name] prefix in ${relPath}:${line}: "${violation.summaryValue.slice(0, 60)}"`,
        file: relPath,
        line,
        fixHint: `Prefix summary with "[${commandName}]" — e.g. summary: "[${commandName}] OK".`,
      });
    }

    const isFailure = violation.exitCodeIsLiteral && violation.exitCodeValue === "1";
    if (isFailure && (!violation.nextStepsPresent || returnText.includes("nextSteps: []"))) {
      diagnostics.push({
        ruleId: "CMD-OUTPUT-03",
        severity: "error",
        message: `Failure return path (exitCode: 1) has no nextSteps in ${relPath}:${line}`,
        file: relPath,
        line,
        fixHint: `Add nextSteps: [{ action: "...", kind: "required" }] to the return object.`,
      });
    }
  }

  return diagnostics;
}

async function scanDirectory(
  dir: string,
  workspaceRoot: string,
): Promise<{ diagnostics: Diagnostic[]; scannedFiles: number }> {
  let scannedFiles = 0;
  const allDiagnostics: Diagnostic[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const subResult = await scanDirectory(fullPath, workspaceRoot);
      scannedFiles += subResult.scannedFiles;
      allDiagnostics.push(...subResult.diagnostics);
    } else if (entry.name.endsWith(".ts") && !shouldExcludeFile(entry.name)) {
      scannedFiles++;
      const fileDiagnostics = await scanFile(fullPath, workspaceRoot);
      allDiagnostics.push(...fileDiagnostics);
    }
  }

  return { diagnostics: allDiagnostics, scannedFiles };
}

function defaultFailNextSteps(): KernelNextStep[] {
  return [
    {
      action: `Fix the CMD-OUTPUT-* violations reported by werkstatt.commands.validate, then re-run the command`,
      kind: "required",
    },
  ];
}

export async function runCommandsValidate(
  workspaceRoot: string,
  mode: "error" | "warning" = "error",
): Promise<KernelCommandResult<CommandsValidateResult>> {
  const scanRoots = [
    join(workspaceRoot, "packages", "werkstatt", "src"),
    join(workspaceRoot, "packages", "werkstatt-site", "src"),
    join(workspaceRoot, "packages", "werkstatt-shared", "src"),
  ];

  let allDiagnostics: Diagnostic[] = [];
  let totalScanned = 0;

  for (const root of scanRoots) {
    const result = await scanDirectory(root, workspaceRoot);
    allDiagnostics.push(...result.diagnostics);
    totalScanned += result.scannedFiles;
  }

  if (mode === "warning") {
    allDiagnostics = allDiagnostics.map((d) => ({
      ...d,
      severity: "warning" as const,
    }));
  }

  const errorCount = allDiagnostics.filter((d) => d.severity === "error").length;
  const hasErrors = errorCount > 0;
  const status: CommandsValidateResult["status"] = hasErrors ? "fail" : "pass";

  const result: CommandsValidateResult = {
    command: COMMAND_NAME,
    status,
    diagnostics: allDiagnostics,
    scannedFiles: totalScanned,
  };

  return {
    data: result,
    exitCode: hasErrors ? 1 : 0,
    summary: `[${COMMAND_NAME}] ${allDiagnostics.length} violation${allDiagnostics.length === 1 ? "" : "s"} across ${totalScanned} files scanned`,
    nextSteps: hasErrors ? defaultFailNextSteps() : undefined,
  };
}
