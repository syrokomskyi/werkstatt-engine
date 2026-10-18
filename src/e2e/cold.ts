/*
<MODULE_CONTRACT>
  <purpose>RFC-0965 + RFC-1324: werkstatt.e2e.cold — cold end-to-end proving run in a disposable temp directory.
  Clones the current checkout, installs dependencies, registers a synthetic Sternsystem from a named intake
  fixture, drives the pipeline through leitstand.ship --until closed plus release.prepare, and asserts zero
  interventions on first attempt. With --with-deploy it continues to a provisional workers.dev deploy,
  probes access protection, and tears the workers down. RFC-1324 zero-fabrication rule: the run writes no
  file a platform command owns — the only writes are intake staging (operator-input bundle) and the compose
  seam (fixture composition/ files under src/content subtrees a composer would own), both guarded by
  e2e.cold-fabrication.lint (FAB-01).</purpose>
  <non-goals>
    <item>Does not replace unit or integration tests — it is the L4 workshop-level proving layer (DNA-66).</item>
    <item>Does not touch real systems-cache or real Cloudflare resources without --with-deploy and explicit env secrets.</item>
    <item>Does not use private API shortcuts — all sub-commands are invoked via executeKernelCommand with public commands.</item>
  </non-goals>
  <key-decisions>
    <item>Fixture systemId is rewritten at staging time (envelope patched + MANIFEST re-hashed) so runs get collision-safe e2e-&lt;fixture&gt; identities while the committed fixtures keep their canonical ids.</item>
    <item>Domainless intakes need Cloudflare creds at REGISTER time (RFC-1325 provisional verification) — the register stage reports `skipped`, never a fake pass, when secrets are absent.</item>
    <item>Stages are an injectable ColdStage[] so cold-stage-failure tests can substitute a failing stage (AC-5) without running the real pipeline.</item>
  </key-decisions>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1189: step 1 — partyKindLabels schema contract

Add required partyKindLabels record (all seven creditPartyKindSchema
members) to materialCreditLabelsSchema plus labelForMaterialCreditKind
helper, so the public credits page renders localized kind labels instead
of raw enum tokens. Seed the e2e cold-test labels fixture and cover the
completeness gate with schema tests.</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <item>RFC-1249: restore diagnostic detail in failResult violations (no placeholder args)</item>
  <item>RFC-1307: canonical org-singleton PBP paths, seeded hreflang+publication.gate, full rollback</item>
  <item>RFC-1324: cold-run defect: handover-dry-run ran complete as sender — recipient key swap for HANDOVER-04</item>
  <history>RFC-0965, RFC-0988, RFC-1307, RFC-1324</history>
</CHANGE_SUMMARY>
*/

import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import { generateKeyPair, toHex, toPem } from "@warpgogol/werkstatt-engine/signing";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { failResult } from "@warpgogol/werkstatt-shared/checks/result-helpers";
import {
  deleteDnsRecord,
  deleteWorkerScript,
  deleteWorkersRoute,
  getWorkersSubdomain,
  listDnsRecords,
  listWorkerNames,
  listWorkersRoutes,
  resolveZoneIdByName,
} from "../leitstand/adapters/cloudflare-api.ts";
import { isProvisionalHost } from "@warpgogol/werkstatt-shared/middleware/site-host";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ColdRunPhase = "closed" | "dev";
export type ColdStepStatus = "pass" | "fail" | "skipped";

export interface ColdRunStep {
  step: string;
  attempts: number;
  durationMs: number;
  ok: boolean;
  status: ColdStepStatus;
  skippedReason?: string;
  error?: string;
}

/** Per-fixture result — RFC-1324 runs one cold birth per fixture, each in its own temp root. */
export interface ColdRunReport {
  fixture: string;
  systemId: string;
  coldRoot: string;
  steps: ColdRunStep[];
  interventions: number;
  reachedPhase: ColdRunPhase;
  timedOut: boolean;
  withDeploy: boolean;
  ok: boolean;
  summary: string;
}

export interface ColdMatrixReport {
  command: "werkstatt.e2e.cold";
  platformCommit: string;
  fixtures: ColdRunReport[];
  summary: string;
}

// ─── Flag helpers ────────────────────────────────────────────────────────────

function flagBool(input: KernelCommandInput, key: string): boolean {
  return input.flags[key] === true;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagNumber(input: KernelCommandInput, key: string): number | undefined {
  const v = input.flags[key];
  return typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined;
}

// ─── Stage runner ────────────────────────────────────────────────────────────

export interface ColdSecrets {
  accountId: string | undefined;
  apiToken: string | undefined;
}

export interface ColdEnv {
  io: WorkspaceIO;
  logger: KernelRuntimeContext["logger"];
  coldRoot: string;
  /** The cloned workshop inside coldRoot. */
  cloneRoot: string;
  /** coldRoot/systems-cache */
  cacheRoot: string;
  /** coldRoot/systems-git */
  gitRoot: string;
  fixture: string;
  systemId: string;
  missionId: string | null;
  platformCommit: string;
  withDeploy: boolean;
  secrets: ColdSecrets;
  /** Populated by the stage-intake step. */
  intake: { relDir: string; domain: string | null } | null;
  perStepTimeout: number;
}

export interface ColdStage {
  name: string;
  /** Skipped when register produced no missionId. */
  requiresMission?: boolean;
  /** Only enters the plan under --with-deploy. */
  deployOnly?: boolean;
  /** Runs even after an earlier stage failed (teardown semantics). */
  always?: boolean;
  /** Return a reason to record the stage as `skipped`, or null to run it. */
  skipWhen?: (env: ColdEnv) => string | null;
  run: (env: ColdEnv) => Promise<void>;
}

async function runStep(
  stepName: string,
  fn: () => Promise<void>,
  logger: KernelRuntimeContext["logger"],
  timeoutMs: number,
): Promise<ColdRunStep> {
  const start = Date.now();
  let ok = false;
  let errorMsg: string | undefined;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`step "${stepName}" timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    await Promise.race([fn(), timeoutPromise]);
    ok = true;
    logger.info(`  [e2e.cold] ${stepName}: ok (${Date.now() - start}ms)`);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    logger.info(`  [e2e.cold] ${stepName}: FAILED — ${errorMsg}`);
  } finally {
    if (timer) clearTimeout(timer);
  }

  return {
    step: stepName,
    attempts: 1,
    durationMs: Date.now() - start,
    ok,
    status: ok ? "pass" : "fail",
    error: errorMsg,
  };
}

function skippedStep(
  name: string,
  reason: string,
  logger: KernelRuntimeContext["logger"],
): ColdRunStep {
  logger.info(`  [e2e.cold] ${name}: skipped — ${reason}`);
  return {
    step: name,
    attempts: 0,
    durationMs: 0,
    ok: true,
    status: "skipped",
    skippedReason: reason,
  };
}

/**
 * RFC-1324 AC-5/AC-6: sequential stage runner. A failed stage marks all
 * subsequent stages `skipped` ("aborted after X") except `always` stages
 * (teardown). `skipWhen` and `requiresMission` produce `skipped` records —
 * a skipped stage is never a pass and never a failure.
 */
export async function runStagePlan(stages: ColdStage[], env: ColdEnv): Promise<ColdRunStep[]> {
  const steps: ColdRunStep[] = [];
  let abortedBy: string | null = null;
  for (const stage of stages) {
    if (abortedBy && !stage.always) {
      steps.push(skippedStep(stage.name, `aborted after '${abortedBy}'`, env.logger));
      continue;
    }
    if (stage.requiresMission && !env.missionId) {
      steps.push(skippedStep(stage.name, "register produced no mission", env.logger));
      continue;
    }
    const reason = stage.skipWhen?.(env) ?? null;
    if (reason) {
      steps.push(skippedStep(stage.name, reason, env.logger));
      continue;
    }
    const step = await runStep(stage.name, () => stage.run(env), env.logger, env.perStepTimeout);
    steps.push(step);
    if (!step.ok) abortedBy = stage.name;
  }
  return steps;
}

// ─── Sub-command runner ─────────────────────────────────────────────────────

async function runSubCommand(
  workspaceRoot: string,
  commandName: string,
  argv: string[],
  logger: KernelRuntimeContext["logger"],
): Promise<{ exitCode: number; summary?: string; data?: unknown }> {
  logger.info(`  [e2e.cold] ${commandName} ${argv.join(" ")}`);
  const result = (await executeKernelCommand({
    workspaceRoot,
    commandName,
    argv,
    outputFormat: "json",
  })) as { exitCode?: number; summary?: string; data?: unknown };

  const code = result.exitCode ?? 0;
  if (code !== 0) {
    throw new Error(`${commandName} failed: ${result.summary ?? "unknown error"}`);
  }
  return { exitCode: code, summary: result.summary, data: result.data };
}

/**
 * io.exec resolves on non-zero exit — cold e2e steps must throw so runStep
 * marks the step failed (same contract execSync gave the original code).
 */
async function execChecked(
  io: WorkspaceIO,
  cmd: string,
  args: string[],
  opts?: Parameters<WorkspaceIO["exec"]>[2],
): Promise<Awaited<ReturnType<WorkspaceIO["exec"]>>> {
  const result = await io.exec(cmd, args, opts);
  if (result.exitCode !== 0) {
    throw new Error(
      `${cmd} ${args[0] ?? ""} exited ${result.exitCode}: ${result.stderr.slice(0, 300) || result.stdout.slice(0, 300)}`,
    );
  }
  return result;
}

// ─── Fixture intake staging (operator-input seam, not platform fabrication) ──

export interface FixtureIntakeInfo {
  relDir: string;
  domain: string | null;
  locales: string[];
}

function fixtureDir(cloneRoot: string, fixture: string): string {
  return path.join(cloneRoot, "packages", "werkstatt-engine", "src", "intake", "fixtures", fixture);
}

/**
 * Stage the fixture's intake bundle at onboarding/&lt;systemId&gt;/.input/intake —
 * the artifact the birth pipeline would have produced for this site. The
 * envelope's systemId is rewritten to the run's e2e-&lt;fixture&gt; identity and
 * the MANIFEST intake.json line re-hashed, exactly what a bundle produced for
 * this id would carry. `composition/` is not part of the intake bundle.
 */
export async function stageFixtureIntake(
  env: Pick<ColdEnv, "io" | "cloneRoot" | "fixture" | "systemId">,
): Promise<FixtureIntakeInfo> {
  const { io, cloneRoot, fixture, systemId } = env;
  const src = fixtureDir(cloneRoot, fixture);
  if (!(await io.exists(path.join(src, "intake.json")))) {
    throw new Error(`stage-intake: no intake.json in fixture '${fixture}' (${src})`);
  }

  const written: string[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await io.readdir(dir)) {
      if (rel === "" && entry.name === "composition") continue;
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      const entryAbs = path.join(dir, entry.name);
      const stat = await io.stat(entryAbs).catch(() => null);
      if (stat?.isDirectory) {
        await walk(entryAbs, entryRel);
      } else {
        written.push(entryRel);
      }
    }
  };
  await walk(src, "");

  // FAB-SEAM-BEGIN: intake-staging
  const intakeDir = path.join(cloneRoot, "onboarding", systemId, ".input", "intake");
  for (const rel of written) {
    const target = path.join(intakeDir, rel);
    await io.mkdir(path.dirname(target));
    await io.copyFile(path.join(src, rel), path.join(intakeDir, rel));
  }
  // Rebind the envelope to the run's system id + re-hash the MANIFEST line so
  // INTAKE-01 sees the bundle a producer would have emitted for this site.
  const intakeRaw = await io.readFile(path.join(intakeDir, "intake.json"));
  const intakeParsed = JSON.parse(intakeRaw) as {
    systemId: string;
    classification?: { domain?: string | null; locales?: Array<{ tag: string }> };
  };
  intakeParsed.systemId = systemId;
  await io.writeFile(
    path.join(intakeDir, "intake.json"),
    `${JSON.stringify(intakeParsed, null, 2)}\n`,
  );
  const newHash = createHash("sha256")
    .update(await io.readFile(path.join(intakeDir, "intake.json")))
    .digest("hex");
  const manifestRaw = await io.readFile(path.join(intakeDir, "MANIFEST.sha256"));
  const manifestLines = manifestRaw
    .split("\n")
    .map((line) => (line.endsWith("  intake.json") ? `${newHash}  intake.json` : line));
  await io.writeFile(path.join(intakeDir, "MANIFEST.sha256"), manifestLines.join("\n"));
  // FAB-SEAM-END: intake-staging

  return {
    relDir: path.join("onboarding", systemId, ".input", "intake"),
    domain: intakeParsed.classification?.domain ?? null,
    locales: (intakeParsed.classification?.locales ?? []).map((l) => l.tag),
  };
}

// ─── Stages ──────────────────────────────────────────────────────────────────

/**
 * Merge a fixture `composition/system.md` overlay onto the seeded manifest.
 * Frontmatter-only documents (`---\n<yaml>\n---\n`): composer keys replace or
 * deep-merge per key, seeded platform fields the overlay never mentions
 * (identity.domain, i18n hreflang/tag, the gate triple) survive untouched.
 * Arrays replace wholesale — pages[] is a complete composer declaration, not
 * a diff.
 */
export function mergeSystemMdFrontmatter(seededRaw: string, overlayRaw: string): string {
  const parseFm = (raw: string): { fm: Record<string, unknown>; rest: string } => {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return { fm: {}, rest: raw };
    const fm = (YAML.parse(match[1] ?? "") ?? {}) as Record<string, unknown>;
    return { fm, rest: raw.slice(match[0].length) };
  };
  const mergeVal = (base: unknown, over: unknown): unknown => {
    if (over === undefined) return base;
    if (
      base !== null &&
      over !== null &&
      typeof base === "object" &&
      typeof over === "object" &&
      !Array.isArray(base) &&
      !Array.isArray(over)
    ) {
      const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
      for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
        merged[k] = mergeVal(merged[k], v);
      }
      return merged;
    }
    return over;
  };
  const seeded = parseFm(seededRaw);
  const overlay = parseFm(overlayRaw);
  const merged = mergeVal(seeded.fm, overlay.fm) as Record<string, unknown>;
  const body = overlay.rest.trim().length > 0 ? overlay.rest : seeded.rest;
  return `---\n${YAML.stringify(merged)}---${body.endsWith("\n") ? body : `${body}\n`}`;
}

function cfSecretsPresent(secrets: ColdSecrets): boolean {
  return Boolean(secrets.accountId) && Boolean(secrets.apiToken);
}

const CF_SKIP = "CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN absent";

// ─── Main command handler ──────────────────────────────────────────────────

export async function runColdE2e(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ColdMatrixReport>> {
  const keep = flagBool(input, "keep");
  const untilFlag = flagString(input, "until") as ColdRunPhase | undefined;
  const until = untilFlag ?? "closed";
  // --until dev implies the deploy legs; --with-deploy stays as the explicit alias.
  const withDeploy = flagBool(input, "with-deploy") || until === "dev";
  const fixtureFlag = flagString(input, "fixture");
  const timeoutMinutes = flagNumber(input, "timeout-minutes") ?? 90;
  const timeoutMs = timeoutMinutes * 60 * 1000;

  const { workspaceRoot, logger } = context;

  const failEarly = (summary: string): KernelCommandResult<ColdMatrixReport> => ({
    exitCode: 1,
    summary,
    nextSteps: [{ action: summary, kind: "required" as const }],
    data: { command: "werkstatt.e2e.cold", platformCommit: "", fixtures: [], summary },
  });

  // Preflight: check working tree is clean
  try {
    const statusOutput = await execChecked(context.io, "git", ["status", "--porcelain"], {
      cwd: workspaceRoot,
      timeoutMs: 10000,
    });
    if (statusOutput.stdout.trim().length > 0) {
      return failEarly(
        "[werkstatt.e2e.cold] preflight failed: working tree is dirty — commit or stash changes before running",
      );
    }
  } catch (err) {
    return failEarly(
      `[werkstatt.e2e.cold] preflight failed: git status check error — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const platformCommit = (
    await execChecked(context.io, "git", ["rev-parse", "HEAD"], {
      cwd: workspaceRoot,
      timeoutMs: 10000,
    })
  ).stdout.trim();

  // Resolve the fixture set: --fixture <name> or every fixtures dir carrying an
  // intake.json (each gets its own cold root, sequentially — RFC-1324 matrix).
  const parentFixturesRoot = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "intake",
    "fixtures",
  );
  const fixtureEntries = await context.io.readdir(parentFixturesRoot).catch(() => []);
  const fixtureNames: string[] = [];
  for (const entry of fixtureEntries) {
    const name = entry.name;
    if (await context.io.exists(path.join(parentFixturesRoot, name, "intake.json"))) {
      fixtureNames.push(name);
    }
  }
  const selected = fixtureFlag ? [fixtureFlag] : fixtureNames;
  if (fixtureFlag && !fixtureNames.includes(fixtureFlag)) {
    return failEarly(
      `[werkstatt.e2e.cold] unknown fixture '${fixtureFlag}' — available: ${fixtureNames.join(", ")}`,
    );
  }

  const secrets: ColdSecrets = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  };

  const reports: ColdRunReport[] = [];

  for (const fixture of selected) {
    const systemId = `e2e-${fixture}`;
    const coldRoot = await context.io.mkdtemp(path.join(os.tmpdir(), "werkstatt-e2e-cold-"));
    logger.info(`[werkstatt.e2e.cold] fixture ${fixture} → ${systemId} @ ${coldRoot}`);

    const cloneRoot = path.join(coldRoot, "werkstatt");
    const env: ColdEnv = {
      io: context.io,
      logger,
      coldRoot,
      cloneRoot,
      cacheRoot: path.join(coldRoot, "systems-cache"),
      gitRoot: path.join(coldRoot, "systems-git"),
      fixture,
      systemId,
      missionId: null,
      platformCommit,
      withDeploy,
      secrets,
      intake: null,
      perStepTimeout: 0,
    };

    const stages = buildFixtureStages(env, workspaceRoot);
    const plan = stages.filter((s) => withDeploy || !s.deployOnly);
    env.perStepTimeout = Math.floor(timeoutMs / Math.max(1, plan.length));

    let report: ColdRunReport;
    try {
      const steps = await runStagePlan(plan, env);
      const interventions = steps.reduce((sum, s) => sum + Math.max(0, s.attempts - 1), 0);
      const failed = steps.filter((s) => s.status === "fail");
      const timedOut = steps.some((s) => s.error?.includes("timed out"));
      const ok = failed.length === 0 && interventions === 0;
      const skipped = steps.filter((s) => s.status === "skipped").map((s) => s.step);
      report = {
        fixture,
        systemId,
        coldRoot,
        steps,
        interventions,
        reachedPhase: until,
        timedOut,
        withDeploy,
        ok,
        summary: ok
          ? `[werkstatt.e2e.cold] ${fixture}: green with 0 interventions${skipped.length ? ` (skipped: ${skipped.join(", ")})` : ""}`
          : `[werkstatt.e2e.cold] ${fixture}: failed at ${failed.map((s) => s.step).join(", ")} (${interventions} interventions)`,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      report = {
        fixture,
        systemId,
        coldRoot,
        steps: [
          {
            step: "fatal",
            attempts: 1,
            durationMs: 0,
            ok: false,
            status: "fail",
            error: errorMsg,
          },
        ],
        interventions: 0,
        reachedPhase: until,
        timedOut: false,
        withDeploy,
        ok: false,
        summary: `[werkstatt.e2e.cold] ${fixture}: fatal error — ${errorMsg}`,
      };
    }
    reports.push(report);

    if (!keep && report.ok) {
      await context.io.rm(coldRoot, { recursive: true }).catch(() => {
        logger.info(`[werkstatt.e2e.cold] warning: could not remove cold root ${coldRoot}`);
      });
    }
  }

  const allOk = reports.every((r) => r.ok);
  const matrix: ColdMatrixReport = {
    command: "werkstatt.e2e.cold",
    platformCommit,
    fixtures: reports,
    summary: allOk
      ? `[werkstatt.e2e.cold] cold run green: ${reports.length} fixture(s), 0 interventions`
      : `[werkstatt.e2e.cold] cold run failed: ${reports
          .filter((r) => !r.ok)
          .map((r) => `${r.fixture} (${r.steps.find((s) => s.status === "fail")?.step ?? "?"})`)
          .join(", ")}`,
  };

  if (!allOk) {
    return { ...failResult("cold", [matrix.summary]), data: matrix };
  }
  return { exitCode: 0, data: matrix, summary: matrix.summary };
}

// ─── Fixture stage plan ──────────────────────────────────────────────────────

/**
 * The birth pipeline as a stage array — injectable so tests substitute stages.
 * Deploy legs only enter the plan under --with-deploy; teardown is `always` so
 * it runs even when an earlier deploy stage failed.
 */
export function buildFixtureStages(env: ColdEnv, parentWorkspaceRoot: string): ColdStage[] {
  const cachePath = path.join(env.cacheRoot, env.systemId);
  const barePath = path.join(env.gitRoot, env.systemId);

  return [
    {
      name: "prepare-cold-root",
      run: async () => {
        await execChecked(env.io, "git", ["clone", parentWorkspaceRoot, env.cloneRoot], {
          timeoutMs: 60000,
        });
        await env.io.mkdir(env.cacheRoot);
        await env.io.mkdir(env.gitRoot);
      },
    },
    {
      name: "install",
      run: async () => {
        await execChecked(env.io, "pnpm", ["install", "--frozen-lockfile"], {
          cwd: env.cloneRoot,
        });
        await execChecked(env.io, "pnpm", ["exec", "playwright", "install", "chromium"], {
          cwd: env.cloneRoot,
        });
      },
    },
    {
      name: "stage-intake",
      run: async () => {
        env.intake = await stageFixtureIntake(env);
      },
    },
    {
      name: "register-site",
      skipWhen: () =>
        env.intake?.domain === null && !cfSecretsPresent(env.secrets)
          ? `${CF_SKIP} — provisional birth domain unverifiable`
          : null,
      run: async () => {
        const keyDir = path.join(env.coldRoot, "signing-key");
        await env.io.mkdir(keyDir);
        await runSubCommand(
          env.cloneRoot,
          "signing.key.generate",
          [`--output-dir=${keyDir}`, "--encoding=pem", "--force"],
          env.logger,
        );
        const privateKeyPem = await env.io.readFile(path.join(keyDir, "signing.key.pem"));
        process.env.SIGNING_PRIVATE_KEY = privateKeyPem.trim();

        await env.io.mkdir(barePath);
        await execChecked(env.io, "git", ["init", "--bare", "-b", "main", barePath]);
        await env.io.mkdir(cachePath);

        const argv = [
          `--id=${env.systemId}`,
          "--cosmicStar=Polaris",
          `--mirrors=${cachePath}:non-bare,${barePath}:bare`,
          `--intake=${env.intake!.relDir}`,
          "--biome=handwerk-material-warm",
        ];
        if (env.intake!.domain === null) {
          const subdomain = await getWorkersSubdomain(
            env.secrets.accountId!,
            env.secrets.apiToken!,
          );
          argv.push(`--domain=${env.systemId}.${subdomain}.workers.dev`);
        }
        const result = (await executeKernelCommand({
          workspaceRoot: env.cloneRoot,
          commandName: "sternsystem.register",
          argv,
          outputFormat: "json",
        })) as { exitCode?: number; summary?: string; data?: { firstMissionId?: string } };
        if ((result.exitCode ?? 0) !== 0) {
          throw new Error(`sternsystem.register failed: ${result.summary ?? "unknown error"}`);
        }

        // RFC-1307: the seeded system.md must validate as-born — assert the
        // i18n/manifest contract instead of repairing it downstream.
        const seededSystemMd = await env.io.readFile(
          path.join(cachePath, "src", "content", "system.md"),
        );
        const fmStart = seededSystemMd.indexOf("---");
        const fmEnd = seededSystemMd.lastIndexOf("---");
        const seededFm = (
          fmStart === -1 || fmEnd <= fmStart
            ? null
            : YAML.parse(seededSystemMd.slice(fmStart + 3, fmEnd))
        ) as {
          i18n?: { supported?: Record<string, { name?: string; hreflang?: string }> };
          identity?: { biome?: string };
        } | null;
        if (!seededFm || Object.keys(seededFm.i18n?.supported ?? {}).length === 0) {
          throw new Error(
            "register-site: seeded system.md has no i18n.supported entries — planner must emit valid i18n",
          );
        }
        for (const [segment, entry] of Object.entries(seededFm.i18n?.supported ?? {})) {
          if (!entry.name || !entry.hreflang) {
            throw new Error(
              `register-site: seeded i18n.supported.${segment} lacks name/hreflang — planner must emit valid i18n`,
            );
          }
        }
        if (seededFm.identity?.biome !== "handwerk-material-warm") {
          throw new Error(
            `register-site: seeded identity.biome is '${seededFm.identity?.biome}' — expected 'handwerk-material-warm'`,
          );
        }

        env.missionId = result.data?.firstMissionId ?? null;
      },
    },
    {
      name: "passport-validate",
      requiresMission: true,
      run: async () => {
        const registryUrl = process.env.FLEET_OWNERSHIP_REGISTRY_URL;
        if (registryUrl) {
          await runSubCommand(
            env.cloneRoot,
            "fleet.ownership.register",
            [`--id=${env.systemId}`],
            env.logger,
          );
          await runSubCommand(
            env.cloneRoot,
            "fleet.ownership.verify",
            [`--id=${env.systemId}`],
            env.logger,
          );
        }
        const result = (await executeKernelCommand({
          workspaceRoot: env.cloneRoot,
          commandName: "sternsystem.validate",
          argv: [`--id=${env.systemId}`, "--json"],
          outputFormat: "json",
        })) as {
          exitCode?: number;
          data?: {
            violations?: Array<{ rule: string; systemId: string; message: string }>;
            warnings?: Array<{ field: string; systemId: string; message: string }>;
          };
        };
        const relevantViolations = (result.data?.violations ?? []).filter(
          (v) =>
            v.rule.startsWith("PASSPORT") ||
            v.rule.startsWith("HANDOVER") ||
            v.rule.startsWith("OWNERSHIP"),
        );
        const relevantWarnings = (result.data?.warnings ?? []).filter(
          (w) =>
            w.field?.startsWith("PASSPORT") ||
            w.field?.startsWith("HANDOVER") ||
            w.field?.startsWith("OWNERSHIP"),
        );
        if (relevantViolations.length > 0) {
          throw new Error(
            `passport-validate: ${relevantViolations.length} PASSPORT/HANDOVER/OWNERSHIP violations: ${relevantViolations.map((v) => `${v.rule}: ${v.message}`).join("; ")}`,
          );
        }
        if (relevantWarnings.length > 0) {
          throw new Error(
            `passport-validate: ${relevantWarnings.length} PASSPORT/HANDOVER/OWNERSHIP warnings: ${relevantWarnings.map((w) => `${w.field}: ${w.message}`).join("; ")}`,
          );
        }
      },
    },
    {
      name: "handover-dry-run",
      requiresMission: true,
      run: async () => {
        // The recipient is a second keypair — prepare runs as the sender (site
        // key), complete runs as the recipient: HANDOVER-04 derives the public
        // key from SIGNING_PRIVATE_KEY and requires it to be the authorized
        // recipient's, so the env var swaps to the recipient PEM for that call.
        const recipient = await generateKeyPair();
        const prepareResult = (await executeKernelCommand({
          workspaceRoot: env.cloneRoot,
          commandName: "sternsystem.handover.prepare",
          argv: [
            `--id=${env.systemId}`,
            "--recipient-identity=human:e2e-recipient",
            `--recipient-public-key=${toHex(recipient.publicKey)}`,
            "--dry-run",
            "--json",
          ],
          outputFormat: "json",
        })) as {
          exitCode?: number;
          data?: { dryRun?: boolean; signedAuthorization?: unknown; authorizationHash?: string };
        };
        if (prepareResult.exitCode !== 0) {
          throw new Error(
            `handover-dry-run: prepare --dry-run failed with exit code ${prepareResult.exitCode}`,
          );
        }
        if (!prepareResult.data?.dryRun || !prepareResult.data?.signedAuthorization) {
          throw new Error("handover-dry-run: prepare --dry-run did not return signedAuthorization");
        }
        const senderKey = process.env.SIGNING_PRIVATE_KEY;
        process.env.SIGNING_PRIVATE_KEY = toPem(recipient.privateKey, "private");
        let completeResult: {
          exitCode?: number;
          data?: { dryRun?: boolean; newPassportHashPreview?: string };
        };
        try {
          completeResult = (await executeKernelCommand({
            workspaceRoot: env.cloneRoot,
            commandName: "sternsystem.handover.complete",
            argv: [
              `--id=${env.systemId}`,
              "--dry-run",
              `--authorization-data=${JSON.stringify(prepareResult.data.signedAuthorization)}`,
              "--json",
            ],
            outputFormat: "json",
          })) as typeof completeResult;
        } finally {
          if (senderKey === undefined) {
            delete process.env.SIGNING_PRIVATE_KEY;
          } else {
            process.env.SIGNING_PRIVATE_KEY = senderKey;
          }
        }
        if (completeResult.exitCode !== 0) {
          throw new Error(
            `handover-dry-run: complete --dry-run failed with exit code ${completeResult.exitCode}`,
          );
        }
        if (!completeResult.data?.dryRun || !completeResult.data?.newPassportHashPreview) {
          throw new Error("handover-dry-run: complete --dry-run did not return preview data");
        }
      },
    },
    {
      name: "compose",
      requiresMission: true,
      run: async () => {
        const missionsDir = path.join(env.cloneRoot, "missions");
        const missionDirs = await env.io
          .readdir(missionsDir)
          .then((e) => e.map((x) => x.name))
          .catch(() => []);
        const missionDir = missionDirs.find((d) => d.includes(env.missionId!));
        if (!missionDir) {
          throw new Error(`compose: mission directory not found for ${env.missionId}`);
        }
        const workpieceDir = path.join(missionsDir, missionDir, "workpiece");
        const compositionSrc = path.join(fixtureDir(env.cloneRoot, env.fixture), "composition");
        if (!(await env.io.exists(compositionSrc))) {
          throw new Error(
            `compose: fixture '${env.fixture}' carries no composition/ directory — the scripted compose step stands in for the composer and needs authored content`,
          );
        }

        // FAB-SEAM-BEGIN: compose
        const COMPOSE_SUBDIRS = ["pages", "prose", "navigation", "site"];
        const COMPOSE_FILES = ["system.md"];
        const composeContentDir = path.join(workpieceDir, "src", "content");
        const applyDir = async (src: string, rel: string): Promise<void> => {
          for (const entry of await env.io.readdir(src)) {
            const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
            const stat = await env.io.stat(path.join(src, entry.name)).catch(() => null);
            if (stat?.isDirectory) {
              if (rel === "" && !COMPOSE_SUBDIRS.includes(entry.name)) {
                throw new Error(
                  `compose: fixture composition carries '${entry.name}/' — only ${COMPOSE_SUBDIRS.join("/")} subtrees are composer territory`,
                );
              }
              await applyDir(path.join(src, entry.name), entryRel);
            } else {
              if (rel === "" && !COMPOSE_FILES.includes(entry.name)) {
                throw new Error(
                  `compose: fixture composition carries '${entry.name}' at root — only ${COMPOSE_FILES.join("/")} overlays are composer territory`,
                );
              }
              const target = path.join(composeContentDir, entryRel);
              await env.io.mkdir(path.dirname(target));
              if (rel === "" && entry.name === "system.md") {
                // The composer edits the seeded manifest — a frontmatter
                // overlay merge, not a replace: platform-seeded fields
                // (identity.domain, i18n hreflang, gates) survive, composer
                // keys (pages[], clientEditable, growth) merge on top.
                const seededRaw = await env.io.readFile(target);
                const overlayRaw = await env.io.readFile(path.join(src, entry.name));
                const merged = mergeSystemMdFrontmatter(seededRaw, overlayRaw);
                await env.io.writeFile(target, merged);
              } else {
                await env.io.copyFile(
                  path.join(src, entry.name),
                  path.join(composeContentDir, entryRel),
                );
              }
            }
          }
        };
        await applyDir(compositionSrc, "");
        // FAB-SEAM-END: compose

        await runSubCommand(
          env.cloneRoot,
          "mission.git.commit",
          [`--mission=${env.missionId}`, "--message=cold-run: scripted composition applied"],
          env.logger,
        );
      },
    },
    {
      name: "ship-closed",
      requiresMission: true,
      run: async () => {
        await runSubCommand(
          env.cloneRoot,
          "leitstand.ship",
          [`--site=${env.systemId}`, `--mission=${env.missionId}`, "--until=closed"],
          env.logger,
        );
        await runSubCommand(
          env.cloneRoot,
          "release.prepare",
          [`--mission=${env.missionId}`],
          env.logger,
        );
      },
    },
    {
      name: "dev-deploy",
      requiresMission: true,
      deployOnly: true,
      skipWhen: () => (!cfSecretsPresent(env.secrets) ? `${CF_SKIP} — deploy legs` : null),
      run: async () => {
        await runSubCommand(
          env.cloneRoot,
          "leitstand.ship",
          [`--site=${env.systemId}`, `--mission=${env.missionId}`, "--until=dev", "--resume"],
          env.logger,
        );
      },
    },
    {
      name: "access-probe",
      requiresMission: true,
      deployOnly: true,
      skipWhen: () => (!cfSecretsPresent(env.secrets) ? `${CF_SKIP} — access probe` : null),
      run: async () => {
        // RFC-1325: first dev deploy auto-protects provisional hosts — a
        // provisional dev channel must answer 401 to an unauthenticated
        // request. A custom-domain dev channel carries no auto-PIN — there
        // the probe asserts reachability instead (2xx/3xx, never 5xx).
        const cfg = YAML.parse(
          await env.io.readFile(path.join(cachePath, "system-config.yaml")),
        ) as { deployment?: { channels?: { dev?: { url?: string } } } };
        const devUrl = cfg.deployment?.channels?.dev?.url;
        if (!devUrl) {
          throw new Error(
            "access-probe: system-config.yaml declares no deployment.channels.dev.url — the deployment block is incomplete",
          );
        }
        const res = await fetch(devUrl, { redirect: "manual" });
        if (isProvisionalHost(new URL(devUrl).hostname)) {
          if (res.status !== 401) {
            throw new Error(
              `access-probe: ${devUrl} answered ${res.status}, expected 401 (RFC-1325 auto-PIN)`,
            );
          }
        } else if (res.status >= 400) {
          throw new Error(
            `access-probe: custom-domain dev channel ${devUrl} answered ${res.status} — deploy did not come up`,
          );
        }
      },
    },
    {
      name: "teardown",
      deployOnly: true,
      always: true,
      skipWhen: () => (!cfSecretsPresent(env.secrets) ? `${CF_SKIP} — nothing deployed` : null),
      run: async () => {
        // Always runs after deploy legs (even on stage failure): delete every
        // worker this birth could have created.
        const existing = new Set(
          await listWorkerNames(env.secrets.accountId!, env.secrets.apiToken!),
        );
        for (const name of [env.systemId, `dev-${env.systemId}`, `alt-${env.systemId}`]) {
          if (!existing.has(name)) continue;
          try {
            await deleteWorkerScript(env.secrets.accountId!, env.secrets.apiToken!, name);
            env.logger.info(`  [e2e.cold] teardown: deleted worker ${name}`);
          } catch (err) {
            env.logger.warn(
              `  [e2e.cold] teardown: could not delete worker ${name} — ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        // Custom-domain fixtures: the deploy also created Workers Routes and
        // DNS records on the real zone (dev.<domain> etc.) — sweep every
        // record whose name carries the e2e systemId. Zone = the confirmed
        // domain's registrable root (last two labels).
        const domain = env.intake?.domain;
        if (domain && !isProvisionalHost(domain)) {
          const labels = domain.split(".");
          const zoneName = labels.slice(-2).join(".");
          const zoneId = await resolveZoneIdByName(zoneName, env.secrets.apiToken!);
          if (!zoneId) {
            env.logger.warn(
              `  [e2e.cold] teardown: zone '${zoneName}' not found — cannot sweep routes/DNS for ${env.systemId}`,
            );
            return;
          }
          for (const route of await listWorkersRoutes(zoneId, env.secrets.apiToken!)) {
            if (!route.pattern.includes(env.systemId)) continue;
            try {
              await deleteWorkersRoute(zoneId, env.secrets.apiToken!, route.id);
              env.logger.info(`  [e2e.cold] teardown: deleted route ${route.pattern}`);
            } catch (err) {
              env.logger.warn(
                `  [e2e.cold] teardown: could not delete route ${route.pattern} — ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
          for (const record of await listDnsRecords(zoneId, env.secrets.apiToken!)) {
            if (!record.name.includes(env.systemId)) continue;
            try {
              await deleteDnsRecord(zoneId, env.secrets.apiToken!, record.id);
              env.logger.info(`  [e2e.cold] teardown: deleted DNS ${record.name}`);
            } catch (err) {
              env.logger.warn(
                `  [e2e.cold] teardown: could not delete DNS ${record.name} — ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }
      },
    },
    {
      name: "abort-second-mission",
      requiresMission: true,
      run: async () => {
        // RFC-1324: prove abort on a cloned workpiece — open a second, empty
        // mission on the closed system and abort it.
        const opened = (await executeKernelCommand({
          workspaceRoot: env.cloneRoot,
          commandName: "mission.open",
          argv: [
            `--system=${env.systemId}`,
            "--brief=e2e-cold: abort proving run",
            "--actor=agent:e2e-cold",
            "--json",
          ],
          outputFormat: "json",
        })) as { exitCode?: number; summary?: string; data?: { missionId?: string } };
        if ((opened.exitCode ?? 0) !== 0 || !opened.data?.missionId) {
          throw new Error(
            `abort-second-mission: mission.open failed — ${opened.summary ?? "no missionId"}`,
          );
        }
        await runSubCommand(
          env.cloneRoot,
          "mission.abort",
          [
            `--mission=${opened.data.missionId}`,
            "--reason=e2e-cold: abort proving run complete",
            "--actor=agent:e2e-cold",
          ],
          env.logger,
        );
      },
    },
  ];
}
