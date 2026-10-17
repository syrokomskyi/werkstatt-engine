/*
<MODULE_CONTRACT>
<purpose>commands-validate — static analysis validator for kernel command output consistency (RFC-0903).</purpose>

<non-goals>
  <item>Does not execute commands — pure static analysis of return statements.</item>
  <item>Does not modify files — produces diagnostics only.</item>
  <item>Does not add itself to PACKAGES_CHECK_PIPELINE — gated adoption per RFC-0903.</item>
  <item>Does not detect dynamically constructed return objects (spread, conditional assignment) — regex-based scanning catches direct object literal returns only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0105: detector gap fix — isHandlerFile missed self-describing KernelCommandDefinition
        files whose type imports span multiple lines; FILE_DETECTION_PATTERNS now includes
        KernelCommandDefinition and the import regex uses [^;]* to cross newlines.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1248: VITE-CLIENT-DEP-02 lazy-import gate + SCAN-02 validator reads-root existence check (RFC-1248)</item>
  <item>RFC-1304: shared fail-loud scan — CMDGEN-05 forbidden-codepoint sweep on raw source, CMDGEN-04 per-definition suspect pairing over the site-src corpus via werkstatt-shared/kernel/command-source-scan.ts (line-anchored comment-aware pragma), CMD-SCAN-01 warnings on unreadable dirs/files and an error on a zero-file corpus; io is injectable for coverage-failure tests.</item>
  <history>RFC-0903</history>
</CHANGE_SUMMARY>
*/

import { join, relative } from "node:path";
import type {
  Diagnostic,
  KernelCommandResult,
  KernelNextStep,
} from "@warpgogol/werkstatt-shared/kernel";
import {
  CMDGEN_IGNORE_RE,
  findDefinitionAnchors,
  maskSource,
  NON_COMMAND_ALLOWLIST,
  scanForbiddenCodepoints,
  unpairedCommandSignals,
} from "@warpgogol/werkstatt-shared/kernel";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import {
  applyValidationBaseline,
  type ValidationBaseline,
} from "@warpgogol/werkstatt-shared/kernel";

export interface CommandsValidateResult {
  command: string;
  status: "pass" | "fail";
  diagnostics: Diagnostic[];
  scannedFiles: number;
  /** RFC-1316: baseline-known violation count (delta mode only). */
  debtViolations?: number;
  /** RFC-1316: baseline file consulted, when delta mode ran. */
  baselineRef?: string;
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
  // Self-describing KernelCommandDefinition files (RFC-1101) — a definition-bearing
  // module may import its result types via multi-line `import type` (invisible to
  // the single-line import regex below) and register no registry call.
  /\bKernelCommandDefinition\b/,
];

// The CMDGEN-04 suspect net only applies to the generator's corpus — site src.
// Engine/shared commands register via registry.registerCommand (a different,
// non-anchored pattern), so the signal would false-positive there.
const SITE_SRC_PREFIX = "packages/werkstatt-site/src/";
const SITE_CHECKS_PREFIX = "packages/werkstatt-site/src/checks/";

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
  // [^;]* (not .*) so multi-line `import type {\n  KernelCommandResult,\n}` is detected —
  // an import statement contains no `;` before its terminator (ADR-0105 detector gap).
  if (/import[^;]*KernelCommandResult|import[^;]*KernelNextStep/.test(content)) return true;
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

async function scanFile(
  filePath: string,
  workspaceRoot: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<Diagnostic[]> {
  // RFC-1304 CMD-SCAN-01: an unreadable input is a coverage gap — warn loudly
  // instead of treating the file as empty and attesting it scanned clean.
  const content = await io.readFile(filePath).catch(() => undefined);
  if (content === undefined) {
    return [
      {
        ruleId: "CMD-SCAN-01",
        severity: "warning",
        message: `File could not be read and was skipped: ${relative(workspaceRoot, filePath)}`,
        file: relative(workspaceRoot, filePath),
        fixHint: `Fix the unreadable file (permissions, encoding, dangling symlink) — the scanner cannot attest coverage over inputs it cannot open (RFC-1304).`,
      },
    ];
  }
  if (!content) return [];

  const diagnostics: Diagnostic[] = [];
  const commandName = inferCommandName(filePath, workspaceRoot);
  const relPath = relative(workspaceRoot, filePath);
  const posixRel = relPath.split("\\").join("/");

  // RFC-1304 CMDGEN-05: invisible/control codepoints are never legitimate in
  // scanned sources — reported on the raw buffer, before the handler gate,
  // never suppressible.
  for (const hit of scanForbiddenCodepoints(content)) {
    diagnostics.push({
      ruleId: "CMDGEN-05",
      severity: "error",
      message: `Forbidden ${hit.name} codepoint (U+${hit.codepoint.toString(16).toUpperCase().padStart(4, "0")}) at offset ${hit.offset} in ${relPath}`,
      file: relPath,
      line: hit.line,
      fixHint: `Remove the invisible byte — it desyncs the masked command scanner (RFC-1304).`,
    });
  }

  // RFC-1304 CMDGEN-04: re-run the generator's suspect-file signal over its own
  // corpus, so a file unreachable during generation is still caught here. The
  // pairing is per-definition: unpaired annotation/satisfies evidence flags the
  // file even when earlier definitions extracted fine.
  if (
    posixRel.startsWith(SITE_SRC_PREFIX) &&
    !CMDGEN_IGNORE_RE.test(maskSource(content, { keepComments: true }))
  ) {
    const masked = maskSource(content);
    const anchors = findDefinitionAnchors(masked);
    const signals = unpairedCommandSignals(masked, anchors);
    if (
      signals.unpaired > 0 &&
      !(
        posixRel.startsWith(SITE_CHECKS_PREFIX) &&
        NON_COMMAND_ALLOWLIST.has(posixRel.slice(SITE_CHECKS_PREFIX.length))
      )
    ) {
      const line =
        signals.firstOffset >= 0
          ? content.slice(0, signals.firstOffset).split("\n").length
          : undefined;
      diagnostics.push({
        ruleId: "CMDGEN-04",
        severity: "error",
        message: `File appears to contain a command definition that was not extracted in ${relPath}`,
        file: relPath,
        line,
        fixHint: `Check for unmaskable constructs (nested template literals, control bytes) or add a // cmdgen-ignore pragma if the file is not a command source (RFC-1304).`,
      });
    }
  }

  if (!isHandlerFile(content)) return diagnostics;

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
  io: WorkspaceIO = createDefaultIO().io,
): Promise<{ diagnostics: Diagnostic[]; scannedFiles: number }> {
  let scannedFiles = 0;
  const allDiagnostics: Diagnostic[] = [];
  const entries = await io.readdir(dir).catch(() => undefined);
  if (entries === undefined) {
    allDiagnostics.push({
      ruleId: "CMD-SCAN-01",
      severity: "warning",
      message: `Directory could not be listed and was skipped: ${relative(workspaceRoot, dir)}`,
      file: relative(workspaceRoot, dir),
      fixHint: `Fix the unreadable directory — the scanner cannot attest coverage over inputs it cannot list (RFC-1304).`,
    });
    return { diagnostics: allDiagnostics, scannedFiles };
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const subResult = await scanDirectory(fullPath, workspaceRoot, io);
      scannedFiles += subResult.scannedFiles;
      allDiagnostics.push(...subResult.diagnostics);
    } else if (entry.name.endsWith(".ts") && !shouldExcludeFile(entry.name)) {
      scannedFiles++;
      const fileDiagnostics = await scanFile(fullPath, workspaceRoot, io);
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
  io: WorkspaceIO = createDefaultIO().io,
  options: { strict?: boolean; baseline?: ValidationBaseline } = {},
): Promise<KernelCommandResult<CommandsValidateResult>> {
  const scanRoots = [
    join(workspaceRoot, "packages", "werkstatt-engine", "src"),
    join(workspaceRoot, "packages", "werkstatt-site", "src"),
    join(workspaceRoot, "packages", "werkstatt-shared", "src"),
  ];

  let allDiagnostics: Diagnostic[] = [];
  let totalScanned = 0;

  for (const root of scanRoots) {
    const result = await scanDirectory(root, workspaceRoot, io);
    allDiagnostics.push(...result.diagnostics);
    totalScanned += result.scannedFiles;
  }

  // RFC-1304 CMD-SCAN-01: a validator that scanned zero files would attest a
  // clean corpus while covering nothing — fail closed on an empty input set.
  if (totalScanned === 0) {
    allDiagnostics.push({
      ruleId: "CMD-SCAN-01",
      severity: "error",
      message: `No source files were scanned under the expected package roots — workspace layout drift or glob failure`,
      fixHint: `Check packages/*/src exists and is readable; the validator cannot attest coverage over an empty corpus (RFC-1304).`,
    });
  }

  if (mode === "warning") {
    allDiagnostics = allDiagnostics.map((d) => ({
      ...d,
      severity: "warning" as const,
    }));
  }

  // RFC-1316 delta mode: baseline-listed errors downgrade to info (known-debt);
  // --strict or a missing/unreadable baseline leaves everything blocking.
  const partitioned = applyValidationBaseline(COMMAND_NAME, allDiagnostics, options);
  allDiagnostics = partitioned.diagnostics;
  const debtCount = partitioned.debt;
  const baselineRef = partitioned.baselineRef;

  const errorCount = allDiagnostics.filter((d) => d.severity === "error").length;
  const hasErrors = errorCount > 0;
  const status: CommandsValidateResult["status"] = hasErrors ? "fail" : "pass";

  const result: CommandsValidateResult = {
    command: COMMAND_NAME,
    status,
    diagnostics: allDiagnostics,
    scannedFiles: totalScanned,
    ...(debtCount > 0 ? { debtViolations: debtCount } : {}),
    ...(baselineRef ? { baselineRef } : {}),
  };

  const debtSuffix = debtCount > 0 ? `, ${debtCount} known-debt` : "";
  return {
    data: result,
    exitCode: hasErrors ? 1 : 0,
    summary: `[${COMMAND_NAME}] ${allDiagnostics.length} violation${allDiagnostics.length === 1 ? "" : "s"} across ${totalScanned} files scanned${debtSuffix}`,
    nextSteps: hasErrors ? defaultFailNextSteps() : undefined,
  };
}
