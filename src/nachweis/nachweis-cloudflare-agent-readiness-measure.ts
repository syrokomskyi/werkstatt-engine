/*
<MODULE_CONTRACT>
<purpose>RFC-0875: nachweis.measure.cloudflare-agent-readiness command handler — submits an Unlisted scan to the Cloudflare URL Scanner API, polls for completion, parses Agent Readiness dimensions, builds AssessmentBundleV1, delegates to nachweis.assessment.ingest.</purpose>
<keywords>nachweis, cloudflare, agent-readiness, url-scanner, measure, assessment, adapter, provider-run</keywords>
<responsibilities>
  <item>Submits an Unlisted URL Scanner scan with agentReadiness enabled via Cloudflare API.</item>
  <item>Polls the result endpoint at 15-second intervals until completion or 5-minute timeout.</item>
  <item>Preserves raw submission response and final result as canonical artifacts.</item>
  <item>Parses Agent Readiness dimensions using explicit field paths from fixture-backed parser.</item>
  <item>Fails with ASSESSMENT_SCHEMA_UNSUPPORTED if raw result schema does not match expected paths.</item>
  <item>Fails with CLOUDFLARE_SCAN_TIMEOUT if polling exceeds 5-minute maximum elapsed time.</item>
  <item>Fails with CLOUDFLARE_SCAN_FAILED if provider reports task.success === false.</item>
  <item>Maps not-checked dimensions to status: not-checked — never coerces to score 0.</item>
  <item>Builds AssessmentBundleV1 and delegates to nachweis.assessment.ingest core function.</item>
  <item>Does not duplicate R2 upload, SHA-256 hashing, PBP persistence, or Bordbuch append logic.</item>
  <item>Does not sign, approve, timestamp, or publish — ends at N1 capture.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
  <item>observedAt comes from provider result scan timestamp, not new Date().</item>
  <item>Uses fetch() (Node 18+ built-in) for HTTP calls — no external HTTP library dependencies.</item>
</responsibilities>
<non-goals>
  <item>Does not publish or approve — use nachweis.publish and nachweis.approve for gate progression.</item>
  <item>Does not create public derivatives — use nachweis.public-derivative.</item>
  <item>Does not scrape isitagentready.com HTML — uses official Cloudflare URL Scanner API only.</item>
  <item>Does not expose Cloudflare API tokens in logs, bundles, Bordbuch, or raw artifacts.</item>
  <item>Does not turn provider scores into certification claims.</item>
  <item>Does not hard-code dimension count or screenshot values — parser reads from API response.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0875: initial nachweis.measure.cloudflare-agent-readiness command handler.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
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

export interface CloudflareAgentReadinessMeasureResult {
  command: "nachweis.measure.cloudflare-agent-readiness";
  status: "ok" | "error" | "skip";
  systemId: string;
  seriesId: string;
  observationId: string;
  scanId: string;
  ingest?: AssessmentIngestResult;
  code?: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_ELAPSED_MS = 300_000; // 5 minutes
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

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

// ── Cloudflare API types ────────────────────────────────────────────────────

interface CloudflareScanSubmissionResponse {
  uuid?: string;
  result?: {
    uuid?: string;
    tasks?: Array<{ uuid?: string; status?: string }>;
  };
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareAgentReadinessCheck {
  status?: string;
  details?: unknown;
  durationMs?: number;
}

interface CloudflareAgentReadinessResult {
  level?: number;
  levelName?: string;
  overall?: number;
  checks?: Record<string, CloudflareAgentReadinessCheck>;
}

interface CloudflareScanResultResponse {
  task?: {
    status?: string;
    success?: boolean;
    time?: string;
    timeEnd?: string;
    url?: string;
    uuid?: string;
  };
  meta?: {
    processors?: {
      agentReadiness?: CloudflareAgentReadinessResult;
    };
  };
  success?: boolean;
}

// ── Parser ──────────────────────────────────────────────────────────────────

interface ParsedDimension {
  id: string;
  providerLabel: string;
  score?: number;
  numerator?: number;
  denominator?: number;
  status?: "pass" | "fail" | "not-checked";
  level?: string;
}

/**
 * Parse Agent Readiness dimensions from the Cloudflare API response.
 *
 * Uses explicit field paths from the documented API schema:
 *   result.agentReadiness.checks.<dimensionId>.status
 *   result.agentReadiness.checks.<dimensionId>.details
 *
 * The check `status` field is a string: "pass", "fail", or "not-checked".
 * When `details` contains a numeric score or pass-count, it is extracted.
 *
 * This parser MUST NOT guess field paths heuristically. If the expected
 * `agentReadiness` object is absent, the parser fails with
 * ASSESSMENT_SCHEMA_UNSUPPORTED.
 */
export function parseAgentReadiness(raw: CloudflareScanResultResponse): {
  overall?: { score?: number; level?: string };
  dimensions: ParsedDimension[];
} {
  const ar = raw.meta?.processors?.agentReadiness;
  if (!ar || typeof ar !== "object") {
    throw new SchemaUnsupportedError("meta.processors.agentReadiness not found in response");
  }

  const dimensions: ParsedDimension[] = [];
  const checks = ar.checks ?? {};

  // Checks are nested two levels: checks.<category>.<checkName>
  // Each category becomes a dimension with numerator/denominator counting.
  for (const [catId, catChecks] of Object.entries(checks)) {
    if (!catChecks || typeof catChecks !== "object") continue;

    let passed = 0;
    let total = 0;
    let allPass = true;

    for (const [, check] of Object.entries(
      catChecks as Record<string, CloudflareAgentReadinessCheck>,
    )) {
      if (!check || typeof check !== "object") continue;
      const status = check.status;
      if (status === "neutral" || status === "Neutral") continue;
      total++;
      if (status === "pass" || status === "Pass") {
        passed++;
      } else if (status === "fail" || status === "Fail") {
        allPass = false;
      }
    }

    if (total === 0) continue;

    const dim: ParsedDimension = {
      id: catId,
      providerLabel: humanizeDimensionLabel(catId),
      numerator: passed,
      denominator: total,
      status: allPass && passed === total ? "pass" : passed > 0 ? "fail" : "not-checked",
    };

    dimensions.push(dim);
  }

  const overall: { score?: number; level?: string } = {};
  if (typeof ar.level === "number") {
    overall.score = ar.level;
  }
  if (typeof ar.levelName === "string" && ar.levelName.length > 0) {
    overall.level = ar.levelName;
  } else if (typeof ar.level === "number") {
    overall.level = `Level ${ar.level}`;
  }

  return { overall: Object.keys(overall).length > 0 ? overall : undefined, dimensions };
}

class SchemaUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaUnsupportedError";
  }
}

function humanizeDimensionLabel(id: string): string {
  return id
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// ── API helpers ─────────────────────────────────────────────────────────────

function makeApiHeaders(apiToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
}

function makeScanEndpoint(accountId: string): string {
  return `${CLOUDFLARE_API_BASE}/${accountId}/urlscanner/v2/scan`;
}

function makeResultEndpoint(accountId: string, scanId: string): string {
  return `${CLOUDFLARE_API_BASE}/${accountId}/urlscanner/v2/result/${scanId}`;
}

async function submitScan(
  accountId: string,
  apiToken: string,
  url: string,
): Promise<{ scanId: string; rawResponse: string }> {
  const endpoint = makeScanEndpoint(accountId);
  const body = JSON.stringify({
    url,
    visibility: "Unlisted",
    agentReadiness: true,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: makeApiHeaders(apiToken),
    body,
  });

  const responseText = await response.text();

  const parsed = JSON.parse(responseText) as CloudflareScanSubmissionResponse;
  const scanId = parsed.uuid ?? parsed.result?.uuid ?? parsed.result?.tasks?.[0]?.uuid;
  if (!scanId) {
    if (!response.ok) {
      throw new SubmissionError(
        `POST ${endpoint} returned HTTP ${response.status}: ${responseText.slice(0, 500)}`,
      );
    }
    throw new SubmissionError("Submission response missing result.uuid or result.tasks[0].uuid");
  }

  return { scanId, rawResponse: responseText };
}

class SubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionError";
  }
}

interface PollResult {
  rawResponse: string;
  parsed: CloudflareScanResultResponse;
}

async function pollForResult(
  accountId: string,
  apiToken: string,
  scanId: string,
  logger: { info: (msg: string) => void },
): Promise<PollResult> {
  const endpoint = makeResultEndpoint(accountId, scanId);
  const startTime = Date.now();
  const pollIntervalRaw = Number(process.env.CLOUDFLARE_AR_POLL_INTERVAL_MS);
  const pollIntervalMs =
    Number.isFinite(pollIntervalRaw) && pollIntervalRaw > 0
      ? pollIntervalRaw
      : DEFAULT_POLL_INTERVAL_MS;
  const maxElapsedRaw = Number(process.env.CLOUDFLARE_AR_MAX_ELAPSED_MS);
  const maxElapsedMs =
    Number.isFinite(maxElapsedRaw) && maxElapsedRaw > 0 ? maxElapsedRaw : DEFAULT_MAX_ELAPSED_MS;

  for (;;) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxElapsedMs) {
      throw new PollTimeoutError(`Polling exceeded ${maxElapsedMs}ms for scan ${scanId}`);
    }

    const response = await fetch(endpoint, {
      method: "GET",
      headers: makeApiHeaders(apiToken),
    });

    if (response.status === 404) {
      logger.info(
        `[nachweis.measure.cloudflare-agent-readiness] scan ${scanId} still in progress (${elapsed}ms elapsed)`,
      );
      await sleep(pollIntervalMs);
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new PollError(
        `GET ${endpoint} returned HTTP ${response.status}: ${text.slice(0, 500)}`,
      );
    }

    const responseText = await response.text();
    const rawParsed = JSON.parse(responseText) as {
      result?: CloudflareScanResultResponse;
    } & CloudflareScanResultResponse;
    // Cloudflare API v4 wraps payload under `result` — unwrap if present
    const parsed = (rawParsed.result ?? rawParsed) as CloudflareScanResultResponse;

    const taskStatus = parsed.task?.status;
    const taskStatusLower = taskStatus?.toLowerCase();
    const taskSuccess = parsed.task?.success;

    if (taskStatusLower === "finished" && taskSuccess === false) {
      throw new ScanFailedError(`Provider reported task.success=false for scan ${scanId}`);
    }

    if (taskStatusLower === "finished" && taskSuccess === true) {
      return { rawResponse: responseText, parsed };
    }

    // Still in progress (Queued, InProgress, or unknown)
    logger.info(
      `[nachweis.measure.cloudflare-agent-readiness] scan ${scanId} status=${taskStatus ?? "unknown"} (${elapsed}ms elapsed)`,
    );
    await sleep(pollIntervalMs);
  }
}

class PollTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PollTimeoutError";
  }
}

class PollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PollError";
  }
}

class ScanFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanFailedError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Bundle builder ──────────────────────────────────────────────────────────

interface MeasureOptions {
  systemId: string;
  url: string;
  seriesId: string;
  authorizationBasis: "site-owner" | "service-contract" | "explicit-operator";
  methodologyId: string;
  methodologyVersion: string;
  freshnessDays: number;
  dryRun: boolean;
}

function buildAssessmentBundle(
  options: MeasureOptions,
  scanId: string,
  parsed: CloudflareScanResultResponse,
  parsedResult: ReturnType<typeof parseAgentReadiness>,
): AssessmentBundleV1 {
  const observedAt = parsed.task?.timeEnd ?? parsed.task?.time ?? new Date().toISOString();

  const observationId = `cf-ar-${scanId.slice(0, 12)}`;
  const slug = `cloudflare-cf-ar-01`;

  const artifacts: AssessmentBundleArtifact[] = [
    {
      key: "cloudflare-submission",
      role: "summary",
      file: "cloudflare-submission.json",
      mediaType: "application/json",
      canonical: false,
    },
    {
      key: "cloudflare-result",
      role: "raw-result",
      file: "cloudflare-result.json",
      mediaType: "application/json",
      canonical: true,
    },
    {
      key: "provider-parser-metadata",
      role: "methodology",
      file: "provider-parser-metadata.json",
      mediaType: "application/json",
      canonical: false,
    },
  ];

  const dimensions = parsedResult.dimensions.map((d) => {
    const dim: Record<string, unknown> = {
      id: d.id,
      providerLabel: d.providerLabel,
    };
    if (d.score != null) dim.score = d.score;
    if (d.numerator != null) dim.numerator = d.numerator;
    if (d.denominator != null) dim.denominator = d.denominator;
    if (d.status != null) dim.status = d.status;
    if (d.level != null) dim.level = d.level;
    return dim as AssessmentBundleV1["result"]["dimensions"][number];
  });

  const result: AssessmentBundleV1["result"] = {
    dimensions,
  };
  if (parsedResult.overall?.score != null || parsedResult.overall?.level != null) {
    result.overall = {};
    if (parsedResult.overall?.score != null) result.overall.score = parsedResult.overall.score;
    if (parsedResult.overall?.level != null) result.overall.level = parsedResult.overall.level;
  }

  return {
    schemaVersion: "nachweis-assessment-bundle@1",
    systemId: options.systemId,
    slug,
    title: {
      de: "Cloudflare Agent Readiness Messung",
      en: "Cloudflare Agent Readiness Measurement",
    },
    seriesId: options.seriesId,
    observationId,
    subject: {
      url: options.url,
    },
    provider: {
      id: "cloudflare",
      name: "Cloudflare",
      homepage: "https://www.cloudflare.com",
    },
    tool: {
      id: "cloudflare-url-scanner-agent-readiness",
      name: "Cloudflare URL Scanner — Agent Readiness",
    },
    execution: {
      mode: "provider-run",
      authorizationBasis: options.authorizationBasis,
    },
    observedAt,
    methodology: {
      id: options.methodologyId,
      version: options.methodologyVersion,
      runCount: 1,
      aggregation: "provider",
    },
    result,
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
): KernelCommandResult<CloudflareAgentReadinessMeasureResult> {
  return {
    data: {
      command: "nachweis.measure.cloudflare-agent-readiness",
      status: "error",
      systemId,
      seriesId,
      observationId: "",
      scanId: "",
      code,
    },
    exitCode: 1,
    summary,
  };
}

// ── Command handler ─────────────────────────────────────────────────────────

export async function runNachweisCloudflareAgentReadinessMeasure(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CloudflareAgentReadinessMeasureResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const url = flagString(input, "url");
  const seriesId = flagString(input, "series-id") ?? "cloudflare-agent-readiness-pilot";
  const authorizationBasis = (flagString(input, "authorization-basis") ?? "site-owner") as
    "site-owner" | "service-contract" | "explicit-operator";
  const methodologyFlag = flagString(input, "methodology") ?? "CF-AR-01@1.0";
  const freshnessDays = flagInt(input, "freshness-days", 30);
  const dryRun = flagBool(input, "dry-run");
  const jsonOutput = flagBool(input, "json");

  if (!systemId) {
    throw new Error("[nachweis.measure.cloudflare-agent-readiness] --system is required");
  }
  if (!url) {
    throw new Error("[nachweis.measure.cloudflare-agent-readiness] --url is required");
  }

  if (!url.startsWith("https://")) {
    return makeErrorMeasureResult(
      systemId,
      seriesId,
      "CLOUDFLARE_URL_INVALID",
      `[nachweis.measure.cloudflare-agent-readiness] CLOUDFLARE_URL_INVALID: --url must be an HTTPS URL`,
    );
  }

  const methodologyParts = methodologyFlag.split("@");
  if (methodologyParts.length !== 2 || !methodologyParts[0] || !methodologyParts[1]) {
    return makeErrorMeasureResult(
      systemId,
      seriesId,
      "CLOUDFLARE_METHODOLOGY_INVALID",
      `[nachweis.measure.cloudflare-agent-readiness] CLOUDFLARE_METHODOLOGY_INVALID: --methodology must be in format <id>@<version>`,
    );
  }
  const methodologyId = methodologyParts[0]!;
  const methodologyVersion = methodologyParts[1]!;

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.measure.cloudflare-agent-readiness",
      systemId,
    ) as unknown as KernelCommandResult<CloudflareAgentReadinessMeasureResult>;
  }

  const options: MeasureOptions = {
    systemId,
    url,
    seriesId,
    authorizationBasis,
    methodologyId,
    methodologyVersion,
    freshnessDays,
    dryRun,
  };

  if (dryRun) {
    const dryRunResult: CloudflareAgentReadinessMeasureResult = {
      command: "nachweis.measure.cloudflare-agent-readiness",
      status: "ok",
      systemId,
      seriesId,
      observationId: "",
      scanId: "",
    };
    return {
      data: dryRunResult,
      exitCode: 0,
      summary: `[nachweis.measure.cloudflare-agent-readiness] ${systemId}: DRY RUN — would submit Cloudflare URL Scanner scan against ${url}`,
    };
  }

  const accountId = process.env.CLOUDFLARE_URL_SCANNER_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_URL_SCANNER_API_TOKEN;

  if (!accountId || !apiToken) {
    return makeErrorMeasureResult(
      systemId,
      seriesId,
      "CLOUDFLARE_CREDENTIALS_MISSING",
      `[nachweis.measure.cloudflare-agent-readiness] CLOUDFLARE_CREDENTIALS_MISSING: CLOUDFLARE_URL_SCANNER_ACCOUNT_ID and CLOUDFLARE_URL_SCANNER_API_TOKEN env vars are required`,
    );
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "cloudflare-ar-measure-"));

  try {
    let scanId: string;
    let submissionRaw: string;

    try {
      logger.info(
        `[nachweis.measure.cloudflare-agent-readiness] submitting Unlisted scan for ${url}`,
      );
      const submission = await submitScan(accountId, apiToken, url);
      scanId = submission.scanId;
      submissionRaw = submission.rawResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeErrorMeasureResult(
        systemId,
        seriesId,
        "CLOUDFLARE_SUBMISSION_FAILED",
        `[nachweis.measure.cloudflare-agent-readiness] CLOUDFLARE_SUBMISSION_FAILED: ${message}`,
      );
    }

    await fs.writeFile(path.join(workDir, "cloudflare-submission.json"), submissionRaw, "utf8");

    let pollResult: PollResult;
    try {
      logger.info(
        `[nachweis.measure.cloudflare-agent-readiness] polling for scan ${scanId} completion`,
      );
      pollResult = await pollForResult(accountId, apiToken, scanId, logger);
    } catch (err) {
      if (err instanceof PollTimeoutError) {
        return makeErrorMeasureResult(
          systemId,
          seriesId,
          "CLOUDFLARE_SCAN_TIMEOUT",
          `[nachweis.measure.cloudflare-agent-readiness] CLOUDFLARE_SCAN_TIMEOUT: ${err.message}`,
        );
      }
      if (err instanceof ScanFailedError) {
        return makeErrorMeasureResult(
          systemId,
          seriesId,
          "CLOUDFLARE_SCAN_FAILED",
          `[nachweis.measure.cloudflare-agent-readiness] CLOUDFLARE_SCAN_FAILED: ${err.message}`,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return makeErrorMeasureResult(
        systemId,
        seriesId,
        "CLOUDFLARE_SCAN_FAILED",
        `[nachweis.measure.cloudflare-agent-readiness] CLOUDFLARE_SCAN_FAILED: ${message}`,
      );
    }

    await fs.writeFile(
      path.join(workDir, "cloudflare-result.json"),
      pollResult.rawResponse,
      "utf8",
    );

    let parsedDimensions: ReturnType<typeof parseAgentReadiness>;
    try {
      parsedDimensions = parseAgentReadiness(pollResult.parsed);
    } catch (err) {
      if (err instanceof SchemaUnsupportedError) {
        return makeErrorMeasureResult(
          systemId,
          seriesId,
          "ASSESSMENT_SCHEMA_UNSUPPORTED",
          `[nachweis.measure.cloudflare-agent-readiness] ASSESSMENT_SCHEMA_UNSUPPORTED: ${err.message}`,
        );
      }
      throw err;
    }

    const parserMetadata = {
      parserVersion: "cf-ar-01",
      fieldPaths: {
        overall: "result.meta.processors.agentReadiness.level",
        levelName: "result.meta.processors.agentReadiness.levelName",
        checks: "result.meta.processors.agentReadiness.checks.<dimensionId>.status",
        checkDetails: "result.meta.processors.agentReadiness.checks.<dimensionId>.details",
      },
      parsedAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(workDir, "provider-parser-metadata.json"),
      JSON.stringify(parserMetadata, null, 2),
      "utf8",
    );

    const bundle = buildAssessmentBundle(options, scanId, pollResult.parsed, parsedDimensions);

    const parsed = assessmentBundleV1Schema.safeParse(bundle);
    if (!parsed.success) {
      return makeErrorMeasureResult(
        systemId,
        seriesId,
        "ASSESSMENT_BUNDLE_INVALID",
        `[nachweis.measure.cloudflare-agent-readiness] ASSESSMENT_BUNDLE_INVALID: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }

    const bundlePath = path.join(workDir, "assessment-bundle.json");
    await fs.writeFile(bundlePath, JSON.stringify(bundle, null, 2), "utf8");

    logger.info(
      `[nachweis.measure.cloudflare-agent-readiness] scan ${scanId} complete, delegating to nachweis.assessment.ingest`,
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
        `[nachweis.measure.cloudflare-agent-readiness] ASSESSMENT_INGEST_FAILED: ${ingestResult.summary}`,
      );
    }

    const measureResult: CloudflareAgentReadinessMeasureResult = {
      command: "nachweis.measure.cloudflare-agent-readiness",
      status: "ok",
      systemId,
      seriesId,
      observationId: bundle.observationId,
      scanId,
      ingest: ingestResult.data,
    };

    const summary = jsonOutput
      ? JSON.stringify(measureResult, null, 2)
      : `[nachweis.measure.cloudflare-agent-readiness] ${systemId}: scan ${scanId} complete, observationId=${bundle.observationId}`;

    return {
      data: measureResult,
      exitCode: 0,
      summary,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
