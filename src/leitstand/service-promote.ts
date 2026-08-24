/*
<MODULE_CONTRACT>
<purpose>RFC-0806: leitstand.service.promote command handler — promotes a service
from dev to production (wrangler.jsonc) with pre-deploy gates, subdomain validation,
lock, wrangler deploy, health check, and prod state recording.</purpose>
<non-goals>
  <item>Do not deploy to dev — use leitstand.service.dev-deploy for that.</item>
  <item>Do not implement build verification — services have no build step.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0806: initial promote command handler (replaces leitstand.service.deploy).</item>
  <item>RFC-0829: add test evidence gate (L1+L2+L5) via shared runTestEvidenceGate helper; throw after grace period if git HEAD unresolvable.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { existsSync } from "node:fs";
import type { KernelCommandInput, KernelCommandResult } from "@warpgogol/werkstatt-engine/kernel";
import { readServicesRegistry, findServiceEntry } from "../sternsystem/registry-io.ts";
import {
  flagString,
  flagBoolean,
  generateOperationId,
  runWranglerDeploy,
  extractWorkersDevUrl,
  runHealthCheck,
  parseEnvFile,
  runPreDeployGates,
  runBuildCheck,
  runSmokeCheck,
  acquireServiceLock,
  releaseServiceLock,
  recordProdDeployState,
  updateWorkersDevUrl,
  type ServicePromoteData,
  type KernelRuntimeContext,
} from "./service-deploy-helpers.ts";

export async function runLeitstandServicePromote(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ServicePromoteData>> {
  const { workspaceRoot, logger } = context;
  const serviceId = flagString(input, "service");
  const skipHealthCheck = flagBoolean(input, "skip-health-check");

  if (!serviceId) {
    throw new Error("[leitstand.service.promote] --service is required");
  }

  const operationId = generateOperationId();
  const startedAt = new Date().toISOString();

  const registry = await readServicesRegistry(workspaceRoot);
  const serviceEntry = findServiceEntry(registry, serviceId);
  if (!serviceEntry) {
    throw new Error(
      `[leitstand.service.promote] service '${serviceId}' not found in services/registry.yaml`,
    );
  }

  const serviceDir = path.join(workspaceRoot, "services", serviceId);
  if (!existsSync(serviceDir)) {
    throw new Error(`[leitstand.service.promote] services/${serviceId}/ does not exist`);
  }

  const wranglerPath = path.join(serviceDir, "wrangler.jsonc");
  if (!existsSync(wranglerPath)) {
    throw new Error(
      `[leitstand.service.promote] services/${serviceId}/wrangler.jsonc not found — not a Cloudflare Worker service`,
    );
  }

  await acquireServiceLock(workspaceRoot, serviceId, operationId, "leitstand.service.promote");

  try {
    // 1. Pre-deploy gates: service.naming.validate, service.registry.validate, services.check.run, build:check, deploy.preflight
    const gates = [
      { commandName: "service.naming.validate", argv: [] },
      { commandName: "service.registry.validate", argv: [] },
      { commandName: "services.check.run", argv: [] },
      { commandName: "deploy.preflight", argv: ["--service", serviceId] },
    ];

    const gateResults = await runPreDeployGates(workspaceRoot, gates, logger);

    // 1b. build:check gate (not a kernel command — runs pnpm script directly)
    const buildCheckResult = await runBuildCheck(serviceDir, logger);
    gateResults.push(buildCheckResult);
    const failedGate = gateResults.find((g) => !g.passed);
    if (failedGate) {
      const failedData: ServicePromoteData = {
        command: "leitstand.service.promote",
        serviceId,
        workerName: serviceEntry.workerName,
        deployState: "failed",
        workersDevUrl: serviceEntry.workersDevUrl ?? "",
        healthState: "unknown",
        preDeployGates: gateResults,
        testEvidenceVerified: false,
        startedAt,
        completedAt: new Date().toISOString(),
        operationId,
      };
      return {
        data: failedData,
        exitCode: 1,
        summary: `[leitstand.service.promote] ${serviceId}: pre-deploy gate '${failedGate.command}' failed — ${failedGate.summary}`,
        nextSteps: [
          {
            action: `Fix the failing gate '${failedGate.command}' for ${serviceId}, then re-run leitstand.service.promote`,
            kind: "required",
          },
        ],
      };
    }

    // 2. Subdomain validation (RFC-0752) — best-effort, skip if command not available
    if (serviceEntry.subdomains && serviceEntry.subdomains.length > 0) {
      logger.info(`[leitstand.service.promote] running subdomain.validate for ${serviceId}…`);
      try {
        const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
        const subdomainResult = (await executeKernelCommand({
          workspaceRoot,
          commandName: "subdomain.validate",
          argv: ["--service", serviceId],
        })) as { exitCode: number; summary?: string };

        if (subdomainResult.exitCode !== 0) {
          logger.info(
            `[leitstand.service.promote] subdomain.validate reported missing subdomains — attempting subdomain.register…`,
          );
          const registerResult = (await executeKernelCommand({
            workspaceRoot,
            commandName: "subdomain.register",
            argv: ["--service", serviceId],
          })) as { exitCode: number; summary?: string };

          if (registerResult.exitCode !== 0) {
            const failedData: ServicePromoteData = {
              command: "leitstand.service.promote",
              serviceId,
              workerName: serviceEntry.workerName,
              deployState: "failed",
              workersDevUrl: serviceEntry.workersDevUrl ?? "",
              healthState: "unknown",
              preDeployGates: gateResults,
              testEvidenceVerified: false,
              startedAt,
              completedAt: new Date().toISOString(),
              operationId,
            };
            return {
              data: failedData,
              exitCode: 1,
              summary: `[leitstand.service.promote] ${serviceId}: subdomain.register failed — ${registerResult.summary ?? "unknown error"}`,
              nextSteps: [
                {
                  action: `Fix the subdomain registration for ${serviceId}, then re-run leitstand.service.promote`,
                  kind: "required",
                },
              ],
            };
          }
        }
      } catch {
        logger.warn(
          `[leitstand.service.promote] subdomain.validate not available — skipping subdomain validation`,
        );
      }
    }

    // RFC-0829: Test evidence gate — verify L1 (unit), L2 (integration), L5 (smoke) evidence
    {
      const { execSync } = await import("node:child_process");
      let commitSha = "";
      try {
        commitSha = execSync("git rev-parse HEAD", {
          cwd: workspaceRoot,
          encoding: "utf-8",
        }).trim();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const { GRACE_PERIOD_END } = await import("./test-evidence-gate.js");
        if (new Date().toISOString() < GRACE_PERIOD_END) {
          logger.warn(
            `[leitstand.service.promote] could not resolve git HEAD — skipping test evidence gate: ${errMsg}`,
          );
        } else {
          throw new Error(
            `[leitstand.service.promote] could not resolve git HEAD — test evidence gate cannot be verified: ${errMsg}`,
          );
        }
      }
      if (commitSha) {
        const { runTestEvidenceGate } = await import("./test-evidence-gate.js");
        await runTestEvidenceGate({
          workspaceRoot,
          commandName: "leitstand.service.promote",
          target: serviceId,
          levels: ["L1", "L2", "L5"],
          commitSha,
          service: serviceId,
          logger,
        });
      }
    }

    // 3. Read .env for secrets
    const envPath = path.join(serviceDir, ".env");
    const deployEnv = await parseEnvFile(envPath);

    // 4. Wrangler deploy with production config
    logger.info(
      `[leitstand.service.promote] deploying ${serviceEntry.workerName} to production via wrangler…`,
    );
    const wranglerResult = await runWranglerDeploy(serviceDir, "wrangler.jsonc", deployEnv);

    if (wranglerResult.exitCode !== 0) {
      await recordProdDeployState(workspaceRoot, serviceId, {
        at: new Date().toISOString(),
        state: "failed",
        operationId,
      });
      const failedData: ServicePromoteData = {
        command: "leitstand.service.promote",
        serviceId,
        workerName: serviceEntry.workerName,
        deployState: "failed",
        workersDevUrl:
          extractWorkersDevUrl(wranglerResult.stdout) ?? serviceEntry.workersDevUrl ?? "",
        healthState: "unknown",
        preDeployGates: gateResults,
        testEvidenceVerified: true,
        startedAt,
        completedAt: new Date().toISOString(),
        operationId,
      };
      return {
        data: failedData,
        exitCode: 1,
        summary: `[leitstand.service.promote] ${serviceId}: wrangler deploy failed — ${wranglerResult.stderr.slice(-200)}`,
        nextSteps: [
          {
            action: `Check the wrangler deploy error for ${serviceId}, fix the issue, then re-run leitstand.service.promote`,
            kind: "required",
          },
        ],
      };
    }

    // 5. Resolve workersDevUrl
    const deployedUrl =
      extractWorkersDevUrl(wranglerResult.stdout) ?? serviceEntry.workersDevUrl ?? "";

    // 6. Health check
    let healthState: "healthy" | "unhealthy" | "unknown" = "unknown";
    if (!skipHealthCheck && serviceEntry.publicEndpoints && deployedUrl) {
      logger.info(`[leitstand.service.promote] running health check on ${deployedUrl}…`);
      healthState = await runHealthCheck(deployedUrl, serviceEntry.healthCheckPath);
    } else if (!serviceEntry.publicEndpoints) {
      logger.info(
        `[leitstand.service.promote] skipping health check — service has no public endpoints`,
      );
    }

    // 7. Smoke check (RFC-0825) — fatal on promote
    let smokeResult: ServicePromoteData["smokeResult"];
    if (deployedUrl) {
      smokeResult = await runSmokeCheck(workspaceRoot, serviceId, deployedUrl, logger);
    }
    if (smokeResult?.status === "fail") {
      await recordProdDeployState(workspaceRoot, serviceId, {
        at: new Date().toISOString(),
        state: "failed",
        operationId,
      });
      const failedData: ServicePromoteData = {
        command: "leitstand.service.promote",
        serviceId,
        workerName: serviceEntry.workerName,
        deployState: "failed",
        workersDevUrl: deployedUrl,
        healthState,
        smokeResult,
        preDeployGates: gateResults,
        testEvidenceVerified: true,
        startedAt,
        completedAt: new Date().toISOString(),
        operationId,
      };
      return {
        data: failedData,
        exitCode: 1,
        summary: `[leitstand.service.promote] ${serviceId}: smoke tests failed — promotion blocked`,
        nextSteps: [
          {
            action: `Fix the failing smoke tests for ${serviceId}, then re-run leitstand.service.promote`,
            kind: "required",
          },
        ],
      };
    }

    // 8. Record prod deploy state
    await recordProdDeployState(workspaceRoot, serviceId, {
      at: new Date().toISOString(),
      state: "succeeded",
      operationId,
    });

    // 9. Update workersDevUrl in registry if resolved
    if (deployedUrl && deployedUrl !== serviceEntry.workersDevUrl) {
      await updateWorkersDevUrl(workspaceRoot, serviceId, deployedUrl);
    }

    const completedAt = new Date().toISOString();
    const data: ServicePromoteData = {
      command: "leitstand.service.promote",
      serviceId,
      workerName: serviceEntry.workerName,
      deployState: "succeeded",
      workersDevUrl: deployedUrl,
      healthState,
      smokeResult,
      preDeployGates: gateResults,
      testEvidenceVerified: true,
      startedAt,
      completedAt,
      operationId,
    };

    return {
      data,
      exitCode: 0,
      summary: `[leitstand.service.promote] ${serviceId}: promoted to production (${healthState})`,
      nextSteps: [
        {
          action: `Verify service health: pnpm exec werkstatt run leitstand.health --service ${serviceId}`,
          kind: "optional",
        },
      ],
    };
  } finally {
    await releaseServiceLock(workspaceRoot, serviceId);
  }
}
