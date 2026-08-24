/*
<MODULE_CONTRACT>
<purpose>RFC-0874: nachweis.measure.lighthouse command handler — runs five sequential canonical Lighthouse runs, parses LHR JSON, aggregates categories, builds AssessmentBundleV1, delegates to nachweis.assessment.ingest.</purpose>
<keywords>nachweis, lighthouse, measure, assessment, adapter, LHR, canonical-run, median</keywords>
<responsibilities>
  <item>Runs Lighthouse CLI five times sequentially against a target URL.</item>
  <item>Preserves raw LHR JSON for every successful canonical run as a canonical artifact.</item>
  <item>Validates canonical run: Lighthouse exits successfully, LHR parses, no fatal runtime error, requested/final URL exists.</item>
  <item>Fails with LIGHTHOUSE_CANONICAL_BATCH_INCOMPLETE if any of the five runs is invalid.</item>
  <item>Fails with LIGHTHOUSE_CHROME_NOT_FOUND if Chrome/Chromium is not installed before any runs begin.</item>
  <item>Aggregates numeric categories via median (index 2 for 5 sorted samples), preserves min/max/samples.</item>
  <item>Preserves non-numeric categories (e.g. Agentic Browsing) as numerator/denominator/status — never coerces to 0-100.</item>
  <item>Builds AssessmentBundleV1 and delegates to nachweis.assessment.ingest core function.</item>
  <item>Does not duplicate R2 upload, SHA-256 hashing, PBP persistence, or Bordbuch append logic.</item>
  <item>Does not sign, approve, timestamp, or publish — ends at N1 capture.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
  <item>observedAt is deterministic from first canonical run fetchTime, not new Date().</item>
</responsibilities>
<non-goals>
  <item>Does not publish or approve — use nachweis.publish and nachweis.approve for gate progression.</item>
  <item>Does not create public derivatives — use nachweis.public-derivative.</item>
  <item>Does not run Lighthouse in parallel — runs are strictly sequential per RFC-0874.</item>
  <item>Does not support "pick best run" — all five successful LHRs are canonical artifacts.</item>
  <item>Does not import the lighthouse package as a static dependency — uses CLI subprocess to keep the engine stack-agnostic.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0874: initial nachweis.measure.lighthouse command handler.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  assessmentBundleV1Schema,
  isNachweisEntitled,
  makeSkipResult,
  type AssessmentBundleV1,
  type AssessmentBundleArtifact,
  type AssessmentIngestResult,
} from "./nachweis-io.ts";
import { runNachweisAssessmentIngest } from "./nachweis-assessment-ingest.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export interface LighthouseCategoryProjection {
  id: string;
  providerLabel: string;
  score?: number;
  numerator?: number;
  denominator?: number;
  status?: "pass" | "fail" | "not-checked";
  level?: string;
  experimental?: boolean;
  min?: number;
  max?: number;
  samples?: number[];
}

export interface LighthouseRunResult {
  runIndex: number;
  lhrPath: string;
  lighthouseVersion: string;
  fetchTime: string;
  userAgent: string;
  requestedUrl: string;
  finalUrl: string;
  categories: LighthouseCategoryProjection[];
}

export interface LighthouseMeasureOptions {
  systemId: string;
  url: string;
  seriesId: string;
  authorizationBasis: "site-owner" | "service-contract" | "explicit-operator";
  runs: number;
  methodologyId: string;
  methodologyVersion: string;
  freshnessDays: number;
  dryRun: boolean;
}

export interface LighthouseMeasureResult {
  command: "nachweis.measure.lighthouse";
  status: "ok" | "error" | "skip";
  systemId: string;
  seriesId: string;
  observationId: string;
  lighthouseVersion: string;
  runCount: number;
  aggregation: "median";
  ingest?: AssessmentIngestResult;
  code?: string;
}

// ── Flag helpers ────────────────────────────────────────────────────────────

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

function flagInt(input: KernelCommandInput, key: string, defaultValue: number): number {
  const v = input.flags[key];
  if (v == null) return defaultValue;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : defaultValue;
}

// ── LHR parsing ─────────────────────────────────────────────────────────────

interface LhrCategory {
  id: string;
  title: string;
  score: number | null;
  experimental?: boolean;
}

interface LhrAuditResult {
  score: number | null;
  scoreDisplayMode?: string;
  numericValue?: number;
}

interface LhrJson {
  lighthouseVersion?: string;
  fetchTime?: string;
  userAgent?: string;
  requestedUrl?: string;
  finalUrl?: string;
  runWarnings?: unknown[];
  runtimeError?: { code?: string; message?: string } | null;
  categories?: Record<string, LhrCategory>;
  audits?: Record<string, LhrAuditResult>;
  configSettings?: Record<string, unknown>;
}

export function parseLhrJson(raw: string): LhrJson {
  return JSON.parse(raw) as LhrJson;
}

export function validateCanonicalRun(lhr: LhrJson): { valid: boolean; reason?: string } {
  if (lhr.runtimeError && lhr.runtimeError.code && lhr.runtimeError.code !== "NO_ERROR") {
    return { valid: false, reason: `runtimeError: ${lhr.runtimeError.code}` };
  }
  if (!lhr.requestedUrl || !lhr.finalUrl) {
    return { valid: false, reason: "missing requestedUrl or finalUrl" };
  }
  if (!lhr.lighthouseVersion) {
    return { valid: false, reason: "missing lighthouseVersion" };
  }
  if (!lhr.fetchTime) {
    return { valid: false, reason: "missing fetchTime" };
  }
  return { valid: true };
}

export function extractCategoryProjection(
  lhr: LhrJson,
  categoryId: string,
  category: LhrCategory,
): LighthouseCategoryProjection | null {
  const score = category.score;
  if (typeof score === "number" && score >= 0 && score <= 1) {
    return {
      id: categoryId,
      providerLabel: category.title,
      score: Math.round(score * 100),
      experimental: category.experimental ?? false,
    };
  }

  if (score === null || score === undefined) {
    if (category.experimental) {
      const auditRefs = lhr.audits ?? {};
      const relevantAudits = Object.entries(auditRefs).filter(
        ([, a]) => a.scoreDisplayMode === "notChecked" || a.scoreDisplayMode === "binary",
      );
      let numerator = 0;
      let denominator = 0;
      for (const [, a] of relevantAudits) {
        denominator++;
        if (a.score === 1) numerator++;
      }
      if (denominator > 0) {
        return {
          id: categoryId,
          providerLabel: category.title,
          numerator,
          denominator,
          status: numerator === denominator ? "pass" : "fail",
          experimental: true,
        };
      }
    }

    return {
      id: categoryId,
      providerLabel: category.title,
      status: "not-checked",
      experimental: category.experimental ?? false,
    };
  }

  return null;
}

export function parseAllCategories(lhr: LhrJson): LighthouseCategoryProjection[] {
  const categories = lhr.categories ?? {};
  const projections: LighthouseCategoryProjection[] = [];
  for (const [id, cat] of Object.entries(categories)) {
    const p = extractCategoryProjection(lhr, id, cat);
    if (p) projections.push(p);
  }
  return projections;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export function aggregateNumericSamples(samples: number[]): {
  median: number;
  min: number;
  max: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    median: sorted[mid],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export function aggregateCategories(
  runResults: LighthouseRunResult[],
): LighthouseCategoryProjection[] {
  const categoryMap = new Map<string, LighthouseCategoryProjection[]>();

  for (const run of runResults) {
    for (const cat of run.categories) {
      const list = categoryMap.get(cat.id) ?? [];
      list.push(cat);
      categoryMap.set(cat.id, list);
    }
  }

  const aggregated: LighthouseCategoryProjection[] = [];

  for (const [id, runs] of categoryMap) {
    const first = runs[0];
    if (!first) continue;

    const numericSamples = runs
      .map((r) => r.score)
      .filter((s): s is number => typeof s === "number");

    if (numericSamples.length === runs.length && numericSamples.length > 0) {
      const { median, min, max } = aggregateNumericSamples(numericSamples);
      aggregated.push({
        id,
        providerLabel: first.providerLabel,
        score: median,
        min,
        max,
        samples: numericSamples,
        experimental: first.experimental,
      });
      continue;
    }

    const passCountRuns = runs.filter((r) => r.numerator != null && r.denominator != null);
    if (passCountRuns.length === runs.length && passCountRuns.length > 0) {
      const numerators = passCountRuns.map((r) => r.numerator!);
      const denominators = passCountRuns.map((r) => r.denominator!);
      const maxDenom = Math.max(...denominators);
      const maxNum = Math.max(...numerators);
      const allPass = passCountRuns.every(
        (r) => r.numerator === r.denominator && r.status === "pass",
      );
      aggregated.push({
        id,
        providerLabel: first.providerLabel,
        numerator: maxNum,
        denominator: maxDenom,
        status: allPass ? "pass" : "fail",
        experimental: first.experimental,
      });
      continue;
    }

    aggregated.push({
      id,
      providerLabel: first.providerLabel,
      status: first.status ?? "not-checked",
      experimental: first.experimental,
    });
  }

  return aggregated;
}

// ── Lighthouse runner ───────────────────────────────────────────────────────

export async function checkChromeAvailable(): Promise<boolean> {
  const chromePath = process.env.CHROME_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH ?? null;
  if (chromePath && existsSync(chromePath)) return true;

  const commonPaths = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of commonPaths) {
    if (existsSync(p)) return true;
  }

  return false;
}

function runLighthouseProcess(
  url: string,
  outputPath: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const args = [
      url,
      "--output=json",
      `--output-path=${outputPath}`,
      "--quiet",
      "--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage",
    ];
    const child = spawn("npx", ["lighthouse", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ exitCode: 124, stderr: `${stderr}\nTIMEOUT after ${timeoutMs}ms` });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stderr });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stderr: `${stderr}\n${err.message}` });
    });
  });
}

async function runLighthouseBatch(
  url: string,
  runs: number,
  workDir: string,
  timeoutPerRunMs: number,
): Promise<LighthouseRunResult[]> {
  const results: LighthouseRunResult[] = [];

  for (let i = 0; i < runs; i++) {
    const runIndex = i + 1;
    const lhrPath = path.join(workDir, `lhr-run-${String(runIndex).padStart(2, "0")}.json`);
    const { exitCode, stderr } = await runLighthouseProcess(url, lhrPath, timeoutPerRunMs);

    if (exitCode !== 0) {
      throw new LighthouseBatchError(
        "LIGHTHOUSE_CANONICAL_BATCH_INCOMPLETE",
        `Run ${runIndex}/${runs} exited with code ${exitCode}: ${stderr.slice(0, 500)}`,
      );
    }

    if (!existsSync(lhrPath)) {
      throw new LighthouseBatchError(
        "LIGHTHOUSE_CANONICAL_BATCH_INCOMPLETE",
        `Run ${runIndex}/${runs} produced no LHR file at ${lhrPath}`,
      );
    }

    let lhr: LhrJson;
    try {
      const raw = await fs.readFile(lhrPath, "utf8");
      lhr = parseLhrJson(raw);
    } catch {
      throw new LighthouseBatchError(
        "LIGHTHOUSE_CANONICAL_BATCH_INCOMPLETE",
        `Run ${runIndex}/${runs} LHR JSON parse failed`,
      );
    }

    const validity = validateCanonicalRun(lhr);
    if (!validity.valid) {
      throw new LighthouseBatchError(
        "LIGHTHOUSE_CANONICAL_BATCH_INCOMPLETE",
        `Run ${runIndex}/${runs} invalid: ${validity.reason}`,
      );
    }

    results.push({
      runIndex,
      lhrPath,
      lighthouseVersion: lhr.lighthouseVersion!,
      fetchTime: lhr.fetchTime!,
      userAgent: lhr.userAgent ?? "",
      requestedUrl: lhr.requestedUrl!,
      finalUrl: lhr.finalUrl!,
      categories: parseAllCategories(lhr),
    });
  }

  return results;
}

class LighthouseBatchError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LighthouseBatchError";
  }
}

// ── Methodology artifact ────────────────────────────────────────────────────

async function writeMethodologyArtifact(
  workDir: string,
  options: LighthouseMeasureOptions,
  lhrMetadata: {
    lighthouseVersion: string;
    userAgent: string;
    requestedUrl: string;
    finalUrl: string;
  },
): Promise<string> {
  const methodologyPath = path.join(workDir, "methodology.json");
  const methodology = {
    methodologyId: options.methodologyId,
    methodologyVersion: options.methodologyVersion,
    lighthouseVersion: lhrMetadata.lighthouseVersion,
    targetUrl: options.url,
    runCount: options.runs,
    aggregation: "median",
    authorizationBasis: options.authorizationBasis,
    userAgent: lhrMetadata.userAgent,
    requestedUrl: lhrMetadata.requestedUrl,
    finalUrl: lhrMetadata.finalUrl,
    freshnessDays: options.freshnessDays,
    environmentFacts: {
      nodeVersion: process.version,
      platform: process.platform,
    },
  };
  await fs.writeFile(methodologyPath, JSON.stringify(methodology, null, 2), "utf8");
  return methodologyPath;
}

// ── Bundle builder ──────────────────────────────────────────────────────────

export function buildAssessmentBundle(
  options: LighthouseMeasureOptions,
  runResults: LighthouseRunResult[],
  aggregatedCategories: LighthouseCategoryProjection[],
): AssessmentBundleV1 {
  const firstRun = runResults[0]!;
  const observationId = `obs-${firstRun.fetchTime.replace(/[^0-9a-zA-Z]/g, "")}`;
  const slug = `lighthouse-${options.methodologyId.toLowerCase()}`;

  const artifacts: AssessmentBundleArtifact[] = runResults.map((r) => ({
    key: `lhr-run-${String(r.runIndex).padStart(2, "0")}`,
    role: "raw-result" as const,
    file: path.basename(r.lhrPath),
    mediaType: "application/json",
    canonical: true,
  }));
  artifacts.push({
    key: "methodology",
    role: "methodology",
    file: "methodology.json",
    mediaType: "application/json",
    canonical: false,
  });

  const dimensions = aggregatedCategories.map((c) => {
    const dim: Record<string, unknown> = {
      id: c.id,
      providerLabel: c.providerLabel,
    };
    if (c.score != null) dim.score = c.score;
    if (c.numerator != null) dim.numerator = c.numerator;
    if (c.denominator != null) dim.denominator = c.denominator;
    if (c.status != null) dim.status = c.status;
    if (c.level != null) dim.level = c.level;
    if (c.experimental != null) dim.experimental = c.experimental;
    if (c.min != null) dim.min = c.min;
    if (c.max != null) dim.max = c.max;
    if (c.samples != null) dim.samples = c.samples;
    return dim as AssessmentBundleV1["result"]["dimensions"][number];
  });

  return {
    schemaVersion: "nachweis-assessment-bundle@1",
    systemId: options.systemId,
    slug,
    title: {
      de: "Google Lighthouse Messung",
      en: "Google Lighthouse Measurement",
    },
    seriesId: options.seriesId,
    observationId,
    subject: {
      url: options.url,
      ...(firstRun.finalUrl !== firstRun.requestedUrl ? { canonicalUrl: firstRun.finalUrl } : {}),
    },
    provider: {
      id: "google-chrome-lighthouse",
      name: "Google Lighthouse",
      homepage: "https://developer.chrome.com/docs/lighthouse",
    },
    tool: {
      id: "lighthouse",
      name: "Lighthouse",
      version: firstRun.lighthouseVersion,
    },
    execution: {
      mode: "operator-run",
      authorizationBasis: options.authorizationBasis,
    },
    observedAt: firstRun.fetchTime,
    methodology: {
      id: options.methodologyId,
      version: options.methodologyVersion,
      runCount: options.runs,
      aggregation: "median",
    },
    result: {
      dimensions,
    },
    freshness: { maxAgeDays: options.freshnessDays },
    artifacts,
  };
}

// ── Error result helper ─────────────────────────────────────────────────────

function makeErrorMeasureResult(
  systemId: string,
  seriesId: string,
  code: string,
  summary: string,
): KernelCommandResult<LighthouseMeasureResult> {
  return {
    data: {
      command: "nachweis.measure.lighthouse",
      status: "error",
      systemId,
      seriesId,
      observationId: "",
      lighthouseVersion: "",
      runCount: 0,
      aggregation: "median",
      code,
    },
    exitCode: 1,
    summary,
  };
}

// ── Command handler ─────────────────────────────────────────────────────────

export async function runNachweisLighthouseMeasure(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<LighthouseMeasureResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const url = flagString(input, "url");
  const seriesId = flagString(input, "series-id") ?? "lighthouse-pilot";
  const authorizationBasis = (flagString(input, "authorization-basis") ?? "site-owner") as
    "site-owner" | "service-contract" | "explicit-operator";
  const runs = flagInt(input, "runs", 5);
  const methodologyFlag = flagString(input, "methodology") ?? "WG-LH-01@1.0";
  const freshnessDays = flagInt(input, "freshness-days", 30);
  const dryRun = flagBool(input, "dry-run");
  const jsonOutput = flagBool(input, "json");

  if (!systemId) throw new Error("[nachweis.measure.lighthouse] --system is required");
  if (!url) throw new Error("[nachweis.measure.lighthouse] --url is required");

  if (!url.startsWith("https://")) {
    return makeErrorMeasureResult(
      systemId,
      seriesId,
      "LIGHTHOUSE_URL_INVALID",
      `[nachweis.measure.lighthouse] LIGHTHOUSE_URL_INVALID: --url must be an HTTPS URL`,
    );
  }

  const methodologyParts = methodologyFlag.split("@");
  if (methodologyParts.length !== 2 || !methodologyParts[0] || !methodologyParts[1]) {
    return makeErrorMeasureResult(
      systemId,
      seriesId,
      "LIGHTHOUSE_METHODOLOGY_INVALID",
      `[nachweis.measure.lighthouse] LIGHTHOUSE_METHODOLOGY_INVALID: --methodology must be in format <id>@<version>`,
    );
  }
  const methodologyId = methodologyParts[0]!;
  const methodologyVersion = methodologyParts[1]!;

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.measure.lighthouse",
      systemId,
    ) as unknown as KernelCommandResult<LighthouseMeasureResult>;
  }

  const options: LighthouseMeasureOptions = {
    systemId,
    url,
    seriesId,
    authorizationBasis,
    runs,
    methodologyId,
    methodologyVersion,
    freshnessDays,
    dryRun,
  };

  if (dryRun) {
    const dryRunResult: LighthouseMeasureResult = {
      command: "nachweis.measure.lighthouse",
      status: "ok",
      systemId,
      seriesId,
      observationId: "",
      lighthouseVersion: "",
      runCount: runs,
      aggregation: "median",
    };
    return {
      data: dryRunResult,
      exitCode: 0,
      summary: `[nachweis.measure.lighthouse] ${systemId}: DRY RUN — would run ${runs} Lighthouse runs against ${url}`,
    };
  }

  const chromeAvailable = await checkChromeAvailable();
  if (!chromeAvailable) {
    return makeErrorMeasureResult(
      systemId,
      seriesId,
      "LIGHTHOUSE_CHROME_NOT_FOUND",
      `[nachweis.measure.lighthouse] LIGHTHOUSE_CHROME_NOT_FOUND: Chrome/Chromium not found. Install Chrome or set CHROME_PATH env variable.`,
    );
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "lighthouse-measure-"));
  const timeoutPerRunMs = 120_000;

  try {
    let runResults: LighthouseRunResult[];
    try {
      logger.info(
        `[nachweis.measure.lighthouse] starting ${runs} sequential Lighthouse runs against ${url}`,
      );
      runResults = await runLighthouseBatch(url, runs, workDir, timeoutPerRunMs);
    } catch (err) {
      const code =
        err instanceof LighthouseBatchError ? err.code : "LIGHTHOUSE_CANONICAL_BATCH_INCOMPLETE";
      return makeErrorMeasureResult(
        systemId,
        seriesId,
        code,
        `[nachweis.measure.lighthouse] ${code}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const aggregatedCategories = aggregateCategories(runResults);

    const firstRun = runResults[0]!;
    await writeMethodologyArtifact(workDir, options, {
      lighthouseVersion: firstRun.lighthouseVersion,
      userAgent: firstRun.userAgent,
      requestedUrl: firstRun.requestedUrl,
      finalUrl: firstRun.finalUrl,
    });

    const bundle = buildAssessmentBundle(options, runResults, aggregatedCategories);

    const parsed = assessmentBundleV1Schema.safeParse(bundle);
    if (!parsed.success) {
      return makeErrorMeasureResult(
        systemId,
        seriesId,
        "ASSESSMENT_BUNDLE_INVALID",
        `[nachweis.measure.lighthouse] ASSESSMENT_BUNDLE_INVALID: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }

    const bundlePath = path.join(workDir, "assessment-bundle.json");
    await fs.writeFile(bundlePath, JSON.stringify(bundle, null, 2), "utf8");

    logger.info(
      `[nachweis.measure.lighthouse] ${runs} runs complete, lighthouseVersion=${firstRun.lighthouseVersion}, delegating to nachweis.assessment.ingest`,
    );

    const ingestInput: KernelCommandInput = {
      argv: [],
      flags: {
        system: systemId,
        bundle: bundlePath,
        "dry-run": false,
      },
    };
    const ingestResult = await runNachweisAssessmentIngest(ingestInput, context);

    if (ingestResult.exitCode !== 0) {
      return makeErrorMeasureResult(
        systemId,
        seriesId,
        "ASSESSMENT_INGEST_FAILED",
        `[nachweis.measure.lighthouse] ASSESSMENT_INGEST_FAILED: ${ingestResult.summary}`,
      );
    }

    const measureResult: LighthouseMeasureResult = {
      command: "nachweis.measure.lighthouse",
      status: "ok",
      systemId,
      seriesId,
      observationId: bundle.observationId,
      lighthouseVersion: firstRun.lighthouseVersion,
      runCount: runs,
      aggregation: "median",
      ingest: ingestResult.data,
    };

    const summary = jsonOutput
      ? JSON.stringify(measureResult, null, 2)
      : `[nachweis.measure.lighthouse] ${systemId}: ${runs} runs complete, observationId=${bundle.observationId}, lighthouseVersion=${firstRun.lighthouseVersion}`;

    return {
      data: measureResult,
      exitCode: 0,
      summary,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
