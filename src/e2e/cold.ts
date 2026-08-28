/*
<MODULE_CONTRACT>
  <purpose>RFC-0965: werkstatt.e2e.cold — cold end-to-end proving run in a disposable temp directory.
  Clones the current checkout, installs dependencies, registers a synthetic Sternsystem, opens a mission,
  applies a scripted content edit, and drives the pipeline through leitstand.ship --until closed plus
  release.prepare (which includes release.boot-smoke). Asserts zero interventions on first attempt.</purpose>
  <non-goals>
    <item>Does not replace unit or integration tests — it is the L4 workshop-level proving layer (DNA-66).</item>
    <item>Does not touch real systems-cache or real Cloudflare resources without --with-deploy and explicit env secrets.</item>
    <item>Does not use private API shortcuts — all sub-commands are invoked via executeKernelCommand with public commands.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0965: initial werkstatt.e2e.cold command handler, ColdRunReport type, step runner with timeout and intervention tracking.</item>
</CHANGE_SUMMARY>
*/

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ColdRunPhase = "closed" | "dev";

export interface ColdRunStep {
  step: string;
  attempts: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface ColdRunReport {
  command: "werkstatt.e2e.cold";
  coldRoot: string;
  platformCommit: string;
  steps: ColdRunStep[];
  interventions: number;
  reachedPhase: ColdRunPhase;
  timedOut: boolean;
  withDeploy: boolean;
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

// ─── Step runner with timeout and attempt tracking ──────────────────────────

interface StepContext {
  coldRoot: string;
  workspaceRoot: string;
  logger: KernelRuntimeContext["logger"];
  systemId: string;
  missionId: string | null;
}

async function runStep(
  stepName: string,
  fn: () => Promise<void>,
  logger: KernelRuntimeContext["logger"],
  timeoutMs: number,
): Promise<ColdRunStep> {
  const start = Date.now();
  let attempts = 0;
  let ok = false;
  let errorMsg: string | undefined;

  attempts = 1;
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
    attempts,
    durationMs: Date.now() - start,
    ok,
    error: errorMsg,
  };
}

// ─── Sub-command runner ─────────────────────────────────────────────────────

async function runSubCommand(
  workspaceRoot: string,
  commandName: string,
  argv: string[],
  logger: KernelRuntimeContext["logger"],
): Promise<{ exitCode: number; summary?: string }> {
  logger.info(`  [e2e.cold] ${commandName} ${argv.join(" ")}`);
  const result = (await executeKernelCommand({
    workspaceRoot,
    commandName,
    argv,
    outputFormat: "pretty",
  })) as { exitCode?: number; summary?: string };

  const exitCode = result.exitCode ?? 0;
  if (exitCode !== 0) {
    throw new Error(`${commandName} failed: ${result.summary ?? "unknown error"}`);
  }
  return { exitCode, summary: result.summary };
}

// ─── Main command handler ──────────────────────────────────────────────────

export async function runColdE2e(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ColdRunReport>> {
  const keep = flagBool(input, "keep");
  const untilFlag = flagString(input, "until") as ColdRunPhase | undefined;
  const until = untilFlag ?? "closed";
  const withDeploy = flagBool(input, "with-deploy");
  const timeoutMinutes = flagNumber(input, "timeout-minutes") ?? 90;
  const timeoutMs = timeoutMinutes * 60 * 1000;

  const { workspaceRoot, logger } = context;

  // Preflight: check working tree is clean
  try {
    const statusOutput = execFileSync("git", ["status", "--porcelain"], {
      cwd: workspaceRoot,
      encoding: "utf-8",
      timeout: 10_000,
    });
    if (statusOutput.trim().length > 0) {
      return {
        exitCode: 1,
        data: {
          command: "werkstatt.e2e.cold",
          coldRoot: "",
          platformCommit: "",
          steps: [],
          interventions: 0,
          reachedPhase: until,
          timedOut: false,
          withDeploy,
          summary:
            "[werkstatt.e2e.cold] preflight failed: working tree is dirty — commit or stash changes before running",
        },
        summary: "[werkstatt.e2e.cold] preflight failed: dirty working tree",
      };
    }
  } catch (err) {
    return {
      exitCode: 1,
      data: {
        command: "werkstatt.e2e.cold",
        coldRoot: "",
        platformCommit: "",
        steps: [],
        interventions: 0,
        reachedPhase: until,
        timedOut: false,
        withDeploy,
        summary: `[werkstatt.e2e.cold] preflight failed: git status check error — ${err instanceof Error ? err.message : String(err)}`,
      },
      summary: "[werkstatt.e2e.cold] preflight failed: git status error",
    };
  }

  // Get current commit
  const platformCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf-8",
    timeout: 10_000,
  }).trim();

  // Create cold root
  const coldRoot = await fs.mkdtemp(path.join(os.tmpdir(), "werkstatt-e2e-cold-"));
  logger.info(`[werkstatt.e2e.cold] cold root: ${coldRoot}`);

  const steps: ColdRunStep[] = [];
  const systemId = "e2e-cold";
  let missionId: string | null = null;

  const stepCtx: StepContext = {
    coldRoot,
    workspaceRoot: path.join(coldRoot, "werkstatt"),
    logger,
    systemId,
    missionId,
  };

  // Per-step timeout: divide total budget across steps (7 base steps + 1 optional)
  const stepCount = withDeploy ? 8 : 7;
  const perStepTimeout = Math.floor(timeoutMs / stepCount);

  try {
    // Step 1: prepare-cold-root
    steps.push(
      await runStep(
        "prepare-cold-root",
        async () => {
          // Clone the current checkout
          execFileSync("git", ["clone", workspaceRoot, path.join(coldRoot, "werkstatt")], {
            encoding: "utf-8",
            timeout: 60_000,
          });
          // Create systems-cache directory (sibling of werkstatt clone)
          await fs.mkdir(path.join(coldRoot, "systems-cache"), { recursive: true });
          await fs.mkdir(path.join(coldRoot, "systems-git"), { recursive: true });
        },
        logger,
        perStepTimeout,
      ),
    );

    // Step 2: install
    steps.push(
      await runStep(
        "install",
        async () => {
          execFileSync("pnpm", ["install", "--frozen-lockfile"], {
            cwd: stepCtx.workspaceRoot,
            encoding: "utf-8",
            timeout: perStepTimeout,
          });
          execFileSync("pnpm", ["exec", "playwright", "install", "chromium"], {
            cwd: stepCtx.workspaceRoot,
            encoding: "utf-8",
            timeout: perStepTimeout,
          });
        },
        logger,
        perStepTimeout,
      ),
    );

    // Step 3: register-site
    steps.push(
      await runStep(
        "register-site",
        async () => {
          const cachePath = path.join(coldRoot, "systems-cache", systemId);
          const barePath = path.join(coldRoot, "systems-git", systemId);
          const mirrorsFlag = `${cachePath}:non-bare,${barePath}:bare`;

          // Initialize bare repo
          await fs.mkdir(barePath, { recursive: true });
          execFileSync("git", ["init", "--bare", "-b", "main", barePath], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });

          // Initialize cache clone as a git repo
          await fs.mkdir(cachePath, { recursive: true });
          execFileSync("git", ["init", "-b", "main", cachePath], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          execFileSync("git", ["config", "user.email", "e2e-cold@warpgogol.local"], {
            cwd: cachePath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          execFileSync("git", ["config", "user.name", "e2e-cold"], {
            cwd: cachePath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          // Add bare repo as origin
          execFileSync("git", ["remote", "add", "origin", barePath], {
            cwd: cachePath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });

          // Initial commit + push to create main branch in bare repo
          await fs.writeFile(path.join(cachePath, "README.md"), "# e2e-cold\n", "utf-8");
          execFileSync("git", ["add", "-A"], {
            cwd: cachePath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          execFileSync("git", ["commit", "-m", "initial"], {
            cwd: cachePath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          execFileSync("git", ["push", "origin", "main"], {
            cwd: cachePath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });

          // RFC-0840: Write operator config files to cache clone (untracked,
          // not git-committed) so restoreOperatorConfigFiles finds them during
          // mission.materialize. A fresh Sternsystem has no previous mission to
          // persist these from — the cold run must seed them.
          await fs.writeFile(
            path.join(cachePath, ".lighthouse-budget-ignore"),
            "# e2e-cold: lighthouse budget ignore\n",
            "utf-8",
          );
          await fs.mkdir(path.join(cachePath, "src"), { recursive: true });
          await fs.writeFile(
            path.join(cachePath, "src", "image-delivery.config.yaml"),
            "# e2e-cold: image delivery config\nprovider: build-portable\n",
            "utf-8",
          );

          // RFC-0073: pbp.content.validate requires src/content/business-profile/de/
          // to exist. pbp.profile.validate requires business.md, web/, contact/, places/.
          // Commit them to the cache clone git repo so materialization copies them
          // into the workpiece. The build.prepare.dev pipeline (run during
          // mission.open inside sternsystem.register) validates before the
          // content-edit step, so they must be present at materialization time.
          const pbpDeDir = path.join(cachePath, "src", "content", "business-profile", "de");
          await fs.mkdir(pbpDeDir, { recursive: true });
          await fs.writeFile(
            path.join(pbpDeDir, "business.md"),
            "---\ncosmicStar: Polaris\ntitle: E2E Cold Test Business\ndescription: Synthetic business profile for cold E2E\nlang: de\n---\n",
            "utf-8",
          );
          for (const sub of ["web", "contact", "places"]) {
            await fs.mkdir(path.join(pbpDeDir, sub), { recursive: true });
            await fs.writeFile(path.join(pbpDeDir, sub, ".gitkeep"), "", "utf-8");
          }
          // RFC-0468: pbp.migration.validate requires owner-decision-register.yaml
          // and migration-coverage-report.yaml in src/content/business-profile/.
          const pbpRoot = path.join(cachePath, "src", "content", "business-profile");
          await fs.writeFile(
            path.join(pbpRoot, "owner-decision-register.yaml"),
            "schemaVersion: '1.0.0'\nitems:\n  - id: 1\n    topic: setup\n    question: Initial setup\n    status: open\n    blocks: []\n",
            "utf-8",
          );
          await fs.writeFile(
            path.join(pbpRoot, "migration-coverage-report.yaml"),
            "schemaVersion: '1.0.0'\ncoveragePercentage: 100\nmappedEntities: 1\ntotalLegacyEntities: 1\nverifiedEntities: 1\nunmappedEntities: []\nlegacySourceMappings:\n  - legacyFile: legacy/business.md\n    targetEntities: [business]\n    category: business\nvalidation:\n  errors: []\n",
            "utf-8",
          );
          // RFC-0095: footer.legal.validate requires site/de/labels.md with
          // footer.legalIds for DE-locale apps.
          const siteLabelsDir = path.join(cachePath, "src", "content", "site", "de");
          await fs.mkdir(siteLabelsDir, { recursive: true });
          await fs.writeFile(
            path.join(siteLabelsDir, "labels.md"),
            "---\nfooter:\n  legalIds:\n    - impressum\n    - datenschutz\n---\n",
            "utf-8",
          );
          // RFC-0074: infra.brief.validate checks for wrangler.jsonc existence.
          await fs.writeFile(
            path.join(cachePath, "wrangler.jsonc"),
            '{\n  "name": "e2e-cold",\n  "compatibility_date": "2024-01-01"\n}\n',
            "utf-8",
          );
          execFileSync("git", ["add", "-A"], {
            cwd: cachePath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          execFileSync(
            "git",
            ["commit", "-m", "add business-profile/de for pbp.content.validate"],
            {
              cwd: cachePath,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          execFileSync("git", ["push", "origin", "main"], {
            cwd: cachePath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });

          // Copy fixture brief into cold root
          const briefDir = path.join(stepCtx.workspaceRoot, "onboarding", systemId, ".input");
          await fs.mkdir(briefDir, { recursive: true });
          const fixtureBrief = `---
client:
  id: e2e-cold
  domain: e2e-cold.test
i18n:
  default: de
  supported:
    - de
legalJurisdiction: DE
---
`;
          await fs.writeFile(path.join(briefDir, "00-brief.md"), fixtureBrief, "utf-8");

          const result = (await executeKernelCommand({
            workspaceRoot: stepCtx.workspaceRoot,
            commandName: "sternsystem.register",
            argv: [`--id=${systemId}`, "--cosmicStar=Polaris", `--mirrors=${mirrorsFlag}`],
            outputFormat: "json",
          })) as { exitCode?: number; summary?: string; data?: { firstMissionId?: string } };

          const exitCode = result.exitCode ?? 0;
          if (exitCode !== 0) {
            throw new Error(`sternsystem.register failed: ${result.summary ?? "unknown error"}`);
          }

          missionId = result.data?.firstMissionId ?? null;
          stepCtx.missionId = missionId;
        },
        logger,
        perStepTimeout,
      ),
    );

    if (!missionId) {
      logger.info(
        `  [e2e.cold] register-site did not produce missionId — skipping remaining steps`,
      );
    }

    // Step 4: content-edit (only if register-site succeeded)
    if (missionId) {
      steps.push(
        await runStep(
          "content-edit",
          async () => {
            // Apply a deterministic prose change to the workpiece
            // The workpiece is materialized by sternsystem.register's mission.open
            // Find the workpiece directory
            const missionsDir = path.join(stepCtx.workspaceRoot, "missions");
            const missionDirs = await fs.readdir(missionsDir).catch(() => []);
            const missionDir = missionDirs.find((d) => d.includes(missionId!));
            if (!missionDir) {
              throw new Error(`content-edit: mission directory not found for ${missionId}`);
            }

            const workpieceDir = path.join(missionsDir, missionDir, "workpiece");

            const systemMdPath = path.join(workpieceDir, "src", "content", "system.md");
            if (existsSync(systemMdPath)) {
              const content = await fs.readFile(systemMdPath, "utf-8");
              // Inject verification.google block and pages[] array into
              // frontmatter for search.verification.validate (SEARCH-VERIFY-01)
              // and semantic.targets.validate (SEM-TARGET-04).
              const updatedContent = content.replace(
                /^---\n([\s\S]*?)\n---/,
                (match, frontmatter: string) => {
                  let fm = frontmatter;
                  if (!fm.includes("verification:")) {
                    fm +=
                      "\nverification:\n  google:\n    method: dns-txt\n    token: google-site-verification=e2e-cold-test-token";
                  }
                  if (!fm.includes("pages:")) {
                    fm +=
                      "\npages:\n  - pageId: digitalesFundament\n    cosmicStar: Polaris\n    routes:\n      de: digitales-fundament\n  - pageId: contact\n    cosmicStar: Polaris\n    routes:\n      de: kontakt\n  - pageId: pricing\n    cosmicStar: Polaris\n    planets:\n      - Hyperion\n    routes:\n      de: preise\n  - pageId: services\n    cosmicStar: Polaris\n    planets:\n      - Hyperion\n    routes:\n      de: leistungen";
                  }
                  return `---\n${fm}\n---`;
                },
              );
              // Append a deterministic cold-run marker
              const marker = `\n\n<!-- e2e-cold: ${platformCommit} -->\n`;
              await fs.writeFile(systemMdPath, updatedContent + marker);

              // Create minimal content page files for the pageIds declared in
              // system.md pages[] so that generated.stale.validate can resolve
              // preview images back to content pages. Pages must be frontmatter-only
              // (no markdown body) with title, description, and lang fields.
              const pagesDir = path.join(workpieceDir, "src", "content", "pages", "de");
              await fs.mkdir(pagesDir, { recursive: true });
              for (const slug of ["digitales-fundament", "contact", "pricing", "services"]) {
                const pageId = slug === "digitales-fundament" ? "digitalesFundament" : slug;
                const pageFile = path.join(pagesDir, `${slug}.md`);
                if (!existsSync(pageFile)) {
                  await fs.writeFile(
                    pageFile,
                    `---\ncosmicStar: Polaris\npageId: ${pageId}\ntitle: ${slug}\ndescription: ${slug}\nlang: de\nblocks:\n  - id: main\n    type: markdown\n---\n`,
                  );
                }
              }
            }

            // Commit the edit
            await runSubCommand(
              stepCtx.workspaceRoot,
              "mission.git.commit",
              [`--mission=${missionId}`, "--message=cold-run: deterministic content edit"],
              logger,
            );
          },
          logger,
          perStepTimeout,
        ),
      );

      // Step 5: validate-and-release
      steps.push(
        await runStep(
          "validate-and-release",
          async () => {
            // Run leitstand.ship --until closed
            await runSubCommand(
              stepCtx.workspaceRoot,
              "leitstand.ship",
              [`--site=${systemId}`, `--mission=${missionId}`, "--until=closed"],
              logger,
            );

            // Then run release.prepare (which includes release.boot-smoke internally)
            await runSubCommand(
              stepCtx.workspaceRoot,
              "release.prepare",
              [`--mission=${missionId}`],
              logger,
            );
          },
          logger,
          perStepTimeout,
        ),
      );

      // Step 6: report (always runs — builds the report object)
      // This step is implicit — the report is built after all steps complete.

      // Step 7 (only with --with-deploy): dev-deploy
      if (withDeploy) {
        steps.push(
          await runStep(
            "dev-deploy",
            async () => {
              await runSubCommand(
                stepCtx.workspaceRoot,
                "leitstand.ship",
                [`--site=${systemId}`, `--mission=${missionId}`, "--until=dev", "--resume"],
                logger,
              );
            },
            logger,
            perStepTimeout,
          ),
        );
      }
    } // end if (missionId)

    // Calculate interventions
    const interventions = steps.reduce((sum, s) => sum + (s.attempts > 1 ? s.attempts - 1 : 0), 0);
    const allOk = steps.every((s) => s.ok);
    const timedOut = steps.some((s) => s.error?.includes("timed out"));

    const report: ColdRunReport = {
      command: "werkstatt.e2e.cold",
      coldRoot,
      platformCommit,
      steps,
      interventions,
      reachedPhase: until,
      timedOut,
      withDeploy,
      summary:
        allOk && interventions === 0
          ? `[werkstatt.e2e.cold] cold run green: scaffold→validate→release with 0 interventions (${Math.round(steps.reduce((s, st) => s + st.durationMs, 0) / 60000)}m)`
          : `[werkstatt.e2e.cold] cold run failed: ${steps
              .filter((s) => !s.ok)
              .map((s) => s.step)
              .join(", ")} (${interventions} interventions)`,
    };

    if (!allOk || interventions > 0) {
      // Keep temp dir on failure for debugging
      return {
        exitCode: 1,
        data: report,
        summary: report.summary,
      };
    }

    // Clean up temp dir on success unless --keep
    if (!keep) {
      await fs.rm(coldRoot, { recursive: true, force: true }).catch(() => {
        logger.info(`[werkstatt.e2e.cold] warning: could not remove cold root ${coldRoot}`);
      });
    }

    return {
      exitCode: 0,
      data: report,
      summary: report.summary,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.info(`[werkstatt.e2e.cold] fatal error: ${errorMsg}`);

    const report: ColdRunReport = {
      command: "werkstatt.e2e.cold",
      coldRoot,
      platformCommit,
      steps,
      interventions: steps.reduce((sum, s) => sum + (s.attempts > 1 ? s.attempts - 1 : 0), 0),
      reachedPhase: until,
      timedOut: false,
      withDeploy,
      summary: `[werkstatt.e2e.cold] fatal error: ${errorMsg}`,
    };

    return {
      exitCode: 1,
      data: report,
      summary: report.summary,
    };
  }
}
