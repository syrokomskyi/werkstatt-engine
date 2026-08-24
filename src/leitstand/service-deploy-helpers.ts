/*
<MODULE_CONTRACT>
<purpose>RFC-0806: Shared types and helpers for the service deployment pipeline
(dev-deploy, promote, rollback). Extracted from service-deploy.ts to avoid duplication
across the three new command handlers.</purpose>
<non-goals>
  <item>Do not implement command-specific logic — handlers own their step sequence.</item>
  <item>Do not export types that are only used by a single command handler.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0806: initial extraction of shared service deploy helpers.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import type { ServiceEntry } from "@warpgogol/werkstatt-engine/schemas";
import type { SmokeRunResult } from "@warpgogol/werkstatt-engine/testing/smoke";
import type { IntegrationRunResult } from "@warpgogol/werkstatt-engine/testing/integration";
import {
  readServicesRegistry,
  writeServicesRegistry,
  findServiceEntry,
} from "../sternsystem/registry-io.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";

export interface PreDeployGateResult {
  command: string;
  passed: boolean;
  summary: string;
}

export interface ServiceDevDeployData {
  command: "leitstand.service.dev-deploy";
  serviceId: string;
  workerName: string;
  deployState: "succeeded" | "failed";
  workersDevUrl: string;
  healthState: "healthy" | "unhealthy" | "unknown";
  smokeResult?: SmokeRunResult;
  integrationResult?: IntegrationRunResult;
  preDeployGates: PreDeployGateResult[];
  startedAt: string;
  completedAt: string;
  operationId: string;
}

export interface ServicePromoteData {
  command: "leitstand.service.promote";
  serviceId: string;
  workerName: string;
  deployState: "succeeded" | "failed";
  workersDevUrl: string;
  healthState: "healthy" | "unhealthy" | "unknown";
  smokeResult?: SmokeRunResult;
  preDeployGates: PreDeployGateResult[];
  testEvidenceVerified: boolean;
  startedAt: string;
  completedAt: string;
  operationId: string;
}

export interface ServiceRollbackData {
  command: "leitstand.service.rollback";
  serviceId: string;
  workerName: string;
  rollbackState: "succeeded" | "failed";
  startedAt: string;
  completedAt: string;
  operationId: string;
}

export function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export function flagBoolean(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export async function runWranglerDeploy(
  serviceDir: string,
  configName: string,
  env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["--yes", "wrangler", "deploy", "--config", configName], {
      cwd: serviceDir,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", () => {
      resolve({ exitCode: 1, stdout, stderr: "Failed to spawn wrangler" });
    });
    child.on("exit", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export async function runWranglerRollback(
  serviceDir: string,
  env: Record<string, string>,
  versionId?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const args = ["--yes", "wrangler", "rollback"];
  if (versionId) {
    args.push(versionId);
  }
  return new Promise((resolve) => {
    const child = spawn("npx", args, {
      cwd: serviceDir,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", () => {
      resolve({ exitCode: 1, stdout, stderr: "Failed to spawn wrangler" });
    });
    child.on("exit", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export function extractWorkersDevUrl(stdout: string): string | undefined {
  const match = stdout.match(/https?:\/\/[^\s]+\.workers\.dev[^\s]*/);
  return match ? match[0] : undefined;
}

export function extractWorkerVersionId(stdout: string): string | undefined {
  const match = stdout.match(/Current Version ID:\s*([a-f0-9-]+)/i);
  return match ? match[1] : undefined;
}

export async function runHealthCheck(
  url: string,
  healthCheckPath: string | undefined,
): Promise<"healthy" | "unhealthy"> {
  const checkUrl = url + (healthCheckPath ?? "/health");
  try {
    const response = await fetch(checkUrl, { redirect: "follow" });
    if (response.status < 500) {
      return "healthy";
    }
    return "unhealthy";
  } catch {
    return "unhealthy";
  }
}

export async function parseEnvFile(envPath: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  if (!existsSync(envPath)) return env;
  const content = await fs.readFile(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value !== "") env[key] = value;
  }
  return env;
}

export async function runBuildCheck(
  serviceDir: string,
  logger: { info: (msg: string) => void },
): Promise<PreDeployGateResult> {
  logger.info("[pre-deploy] running build:check (tsc --noEmit)…");
  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn("pnpm", ["run", "build:check"], {
        cwd: serviceDir,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      child.on("error", () =>
        resolve({ exitCode: 1, stdout, stderr: "Failed to spawn build:check" }),
      );
      child.on("exit", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    },
  );
  return {
    command: "build:check",
    passed: result.exitCode === 0,
    summary:
      result.exitCode === 0
        ? "tsc --noEmit: 0 errors"
        : result.stderr.slice(-200) || result.stdout.slice(-200) || "failed",
  };
}

export interface PreDeployGateConfig {
  commandName: string;
  argv: string[];
}

export async function runPreDeployGates(
  workspaceRoot: string,
  gates: PreDeployGateConfig[],
  logger: { info: (msg: string) => void },
): Promise<PreDeployGateResult[]> {
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
  const results: PreDeployGateResult[] = [];

  for (const gate of gates) {
    logger.info(`[pre-deploy] running ${gate.commandName}…`);
    const result = (await executeKernelCommand({
      workspaceRoot,
      commandName: gate.commandName,
      argv: gate.argv,
    })) as { exitCode: number; summary?: string };

    const passed = result.exitCode === 0;
    results.push({
      command: gate.commandName,
      passed,
      summary: result.summary ?? (passed ? "pass" : "failed"),
    });

    if (!passed) break;
  }

  return results;
}

export async function acquireServiceLock(
  workspaceRoot: string,
  serviceId: string,
  operationId: string,
  commandName: string,
): Promise<void> {
  await acquireLock(workspaceRoot, `service:${serviceId}`, operationId, commandName, "agent");
}

export async function releaseServiceLock(workspaceRoot: string, serviceId: string): Promise<void> {
  await releaseLock(workspaceRoot, `service:${serviceId}`);
}

export async function recordDevDeployState(
  workspaceRoot: string,
  serviceId: string,
  state: { at: string; state: "succeeded" | "failed"; operationId: string },
): Promise<void> {
  const registry = await readServicesRegistry(workspaceRoot);
  const entry = registry.services.find((s: ServiceEntry) => s.id === serviceId);
  if (!entry) return;
  (entry as Record<string, unknown>).lastDevDeployed = {
    at: state.at,
    state: state.state,
    operationId: state.operationId,
  };
  await writeServicesRegistry(workspaceRoot, registry);
}

export async function recordProdDeployState(
  workspaceRoot: string,
  serviceId: string,
  state: { at: string; state: "succeeded" | "failed" | "rolled-back"; operationId: string },
): Promise<void> {
  const registry = await readServicesRegistry(workspaceRoot);
  const entry = registry.services.find((s: ServiceEntry) => s.id === serviceId);
  if (!entry) return;
  entry.lastDeployed = {
    at: state.at,
    state: state.state === "rolled-back" ? "failed" : state.state,
    operationId: state.operationId,
  };
  await writeServicesRegistry(workspaceRoot, registry);
}

export async function updateWorkersDevUrl(
  workspaceRoot: string,
  serviceId: string,
  deployedUrl: string,
): Promise<void> {
  if (!deployedUrl) return;
  const registry = await readServicesRegistry(workspaceRoot);
  const entry = findServiceEntry(registry, serviceId);
  if (entry && entry.workersDevUrl !== deployedUrl) {
    entry.workersDevUrl = deployedUrl;
    await writeServicesRegistry(workspaceRoot, registry);
  }
}

export { generateOperationId };

export type { KernelRuntimeContext };

export async function runSmokeCheck(
  workspaceRoot: string,
  serviceId: string,
  deployedUrl: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<SmokeRunResult | undefined> {
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
  logger.info(`[smoke] running service.smoke.run for ${serviceId} against ${deployedUrl}…`);
  try {
    const result = (await executeKernelCommand({
      workspaceRoot,
      commandName: "service.smoke.run",
      argv: [`--service=${serviceId}`, `--url=${deployedUrl}`],
    })) as { exitCode?: number; data?: SmokeRunResult };
    if (result.data) {
      return result.data;
    }
    logger.warn(
      `[smoke] service.smoke.run returned no data (exitCode=${result.exitCode ?? "unknown"})`,
    );
    return undefined;
  } catch (err) {
    logger.warn(
      `[smoke] service.smoke.run failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

export async function runIntegrationTests(
  workspaceRoot: string,
  serviceId: string,
  deployedUrl: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<IntegrationRunResult | undefined> {
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
  logger.info(
    `[integration] running service.integration.run for ${serviceId} against ${deployedUrl}…`,
  );
  try {
    const result = (await executeKernelCommand({
      workspaceRoot,
      commandName: "service.integration.run",
      argv: [`--service=${serviceId}`, `--url=${deployedUrl}`],
    })) as { exitCode?: number; data?: IntegrationRunResult };
    if (result.data) {
      return result.data;
    }
    logger.warn(
      `[integration] service.integration.run returned no data (exitCode=${result.exitCode ?? "unknown"})`,
    );
    return undefined;
  } catch (err) {
    logger.warn(
      `[integration] service.integration.run failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}
