/*
<MODULE_CONTRACT>
<purpose>RFC-0806: leitstand.service.dev-deploy command handler — deploys a service
to the dev channel (wrangler.dev.jsonc) with pre-deploy gates, lock, wrangler deploy,
health check, and dev state recording.</purpose>
<non-goals>
  <item>Do not deploy to production — use leitstand.service.promote for that.</item>
  <item>Do not run subdomain validation — dev Workers use *.workers.dev URLs only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0806: initial dev-deploy command handler.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { existsSync } from "node:fs";
import { copyFileSync } from "node:fs";
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
  runIntegrationTests,
  acquireServiceLock,
  releaseServiceLock,
  recordDevDeployState,
  updateWorkersDevUrl,
  type ServiceDevDeployData,
  type KernelRuntimeContext,
} from "./service-deploy-helpers.ts";

export async function runLeitstandServiceDevDeploy(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ServiceDevDeployData>> {
  const { workspaceRoot, logger } = context;
  const serviceId = flagString(input, "service");
  const skipHealthCheck = flagBoolean(input, "skip-health-check");

  if (!serviceId) {
    throw new Error("[leitstand.service.dev-deploy] --service is required");
  }

  const operationId = generateOperationId();
  const startedAt = new Date().toISOString();

  const registry = await readServicesRegistry(workspaceRoot);
  const serviceEntry = findServiceEntry(registry, serviceId);
  if (!serviceEntry) {
    throw new Error(
      `[leitstand.service.dev-deploy] service '${serviceId}' not found in services/registry.yaml`,
    );
  }

  const serviceDir = path.join(workspaceRoot, "services", serviceId);
  if (!existsSync(serviceDir)) {
    throw new Error(`[leitstand.service.dev-deploy] services/${serviceId}/ does not exist`);
  }

  const devConfigPath = path.join(serviceDir, "wrangler.dev.jsonc");
  if (!existsSync(devConfigPath)) {
    throw new Error(
      `[leitstand.service.dev-deploy] services/${serviceId}/wrangler.dev.jsonc not found — cannot dev-deploy without dev config`,
    );
  }

  await acquireServiceLock(workspaceRoot, serviceId, operationId, "leitstand.service.dev-deploy");

  // Auto-create .env.dev from .env if .env.dev is missing but .env and .env.dev.example exist
  const envDevPath = path.join(serviceDir, ".env.dev");
  const envPath = path.join(serviceDir, ".env");
  const envDevExamplePath = path.join(serviceDir, ".env.dev.example");
  if (!existsSync(envDevPath) && existsSync(envPath) && existsSync(envDevExamplePath)) {
    try {
      copyFileSync(envPath, envDevPath);
      logger.info(`[leitstand.service.dev-deploy] auto-created .env.dev from .env`);
    } catch {
      // best-effort — deploy.preflight will report the error
    }
  }

  try {
    // 1. Pre-deploy gates: service.naming.validate, service.registry.validate, services.check.run, build:check, deploy.preflight --dev
    const gates = [
      { commandName: "service.naming.validate", argv: [] },
      { commandName: "service.registry.validate", argv: [] },
      { commandName: "services.check.run", argv: [] },
      { commandName: "deploy.preflight", argv: ["--service", serviceId, "--dev"] },
    ];

    const gateResults = await runPreDeployGates(workspaceRoot, gates, logger);

    // 1b. build:check gate (not a kernel command — runs pnpm script directly)
    const buildCheckResult = await runBuildCheck(serviceDir, logger);
    gateResults.push(buildCheckResult);
    const failedGate = gateResults.find((g) => !g.passed);
    if (failedGate) {
      const failedData: ServiceDevDeployData = {
        command: "leitstand.service.dev-deploy",
        serviceId,
        workerName: serviceEntry.workerName,
        deployState: "failed",
        workersDevUrl: serviceEntry.workersDevUrl ?? "",
        healthState: "unknown",
        preDeployGates: gateResults,
        startedAt,
        completedAt: new Date().toISOString(),
        operationId,
      };
      return {
        data: failedData,
        exitCode: 1,
        summary: `[leitstand.service.dev-deploy] ${serviceId}: pre-deploy gate '${failedGate.command}' failed — ${failedGate.summary}`,
        nextSteps: [
          {
            action: `Fix the failing gate '${failedGate.command}' for ${serviceId}, then re-run leitstand.service.dev-deploy`,
            kind: "required",
          },
        ],
      };
    }

    // 2. Read .env.dev for secrets
    const envDevPath = path.join(serviceDir, ".env.dev");
    const deployEnv = await parseEnvFile(envDevPath);

    // 3. Wrangler deploy with dev config
    logger.info(
      `[leitstand.service.dev-deploy] deploying ${serviceEntry.workerName}-dev via wrangler…`,
    );
    const wranglerResult = await runWranglerDeploy(serviceDir, "wrangler.dev.jsonc", deployEnv);

    if (wranglerResult.exitCode !== 0) {
      await recordDevDeployState(workspaceRoot, serviceId, {
        at: new Date().toISOString(),
        state: "failed",
        operationId,
      });
      const failedData: ServiceDevDeployData = {
        command: "leitstand.service.dev-deploy",
        serviceId,
        workerName: serviceEntry.workerName,
        deployState: "failed",
        workersDevUrl: extractWorkersDevUrl(wranglerResult.stdout) ?? "",
        healthState: "unknown",
        preDeployGates: gateResults,
        startedAt,
        completedAt: new Date().toISOString(),
        operationId,
      };
      return {
        data: failedData,
        exitCode: 1,
        summary: `[leitstand.service.dev-deploy] ${serviceId}: wrangler deploy failed — ${wranglerResult.stderr.slice(-200)}`,
        nextSteps: [
          {
            action: `Check the wrangler deploy error for ${serviceId}, fix the issue, then re-run leitstand.service.dev-deploy`,
            kind: "required",
          },
        ],
      };
    }

    // 4. Resolve workersDevUrl from wrangler output
    const deployedUrl = extractWorkersDevUrl(wranglerResult.stdout) ?? "";

    // 5. Health check (skip if --skip-health-check or no URL)
    let healthState: "healthy" | "unhealthy" | "unknown" = "unknown";
    if (!skipHealthCheck && deployedUrl) {
      logger.info(`[leitstand.service.dev-deploy] running health check on ${deployedUrl}…`);
      healthState = await runHealthCheck(deployedUrl, serviceEntry.healthCheckPath);
    }

    // 6. Smoke check (RFC-0825)
    let smokeResult: ServiceDevDeployData["smokeResult"];
    if (deployedUrl) {
      smokeResult = await runSmokeCheck(workspaceRoot, serviceId, deployedUrl, logger);
    }

    // 6b. Integration tests (RFC-0826) — non-fatal, warnings only
    let integrationResult: ServiceDevDeployData["integrationResult"];
    if (deployedUrl) {
      integrationResult = await runIntegrationTests(workspaceRoot, serviceId, deployedUrl, logger);
    }

    // 7. Record dev deploy state
    await recordDevDeployState(workspaceRoot, serviceId, {
      at: new Date().toISOString(),
      state: "succeeded",
      operationId,
    });

    // 8. Update workersDevUrl in registry if resolved
    if (deployedUrl) {
      await updateWorkersDevUrl(workspaceRoot, serviceId, deployedUrl);
    }

    const completedAt = new Date().toISOString();
    const data: ServiceDevDeployData = {
      command: "leitstand.service.dev-deploy",
      serviceId,
      workerName: serviceEntry.workerName,
      deployState: "succeeded",
      workersDevUrl: deployedUrl,
      healthState,
      smokeResult,
      integrationResult,
      preDeployGates: gateResults,
      startedAt,
      completedAt,
      operationId,
    };

    return {
      data,
      exitCode: 0,
      summary: `[leitstand.service.dev-deploy] ${serviceId}: dev-deployed (${healthState})`,
      nextSteps: [
        {
          action: `Promote service to production: pnpm exec werkstatt run leitstand.service.promote --service ${serviceId}`,
          kind: "optional",
        },
      ],
    };
  } finally {
    await releaseServiceLock(workspaceRoot, serviceId);
  }
}
