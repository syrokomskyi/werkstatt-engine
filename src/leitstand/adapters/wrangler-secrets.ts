/*
<MODULE_CONTRACT>
  <purpose>RFC-1065: Shared wrangler secret helpers — parameterized runWranglerSecretPut and runWranglerSecretDelete for provisioning secrets on Cloudflare Workers via wrangler CLI.</purpose>
  <keywords>wrangler, secret, put, delete, cloudflare, worker, RFC-1065, RFC-0899</keywords>
  <responsibilities>
    <item>runWranglerSecretPut: spawn npx wrangler secret put <secretName> --name <workerName>, pipe value to stdin.</item>
    <item>runWranglerSecretDelete: spawn npx wrangler secret delete <secretName> --name <workerName>.</item>
    <item>Both return exitCode, stdout, stderr — callers handle success/failure.</item>
    <item>Never log the secret value — only the secret name appears in stdout/stderr.</item>
  </responsibilities>
  <non-goals>
    <item>Do not interpret results or decide retry logic — that is the caller's responsibility.</item>
    <item>Do not create temporary wrangler.jsonc — the caller sets cwd appropriately.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1065: extracted from access-commands.ts as parameterized shared helpers for reuse by lagebild commands.</item>
</CHANGE_SUMMARY>
*/

import { spawn } from "node:child_process";

export async function runWranglerSecretPut(
  workerName: string,
  secretName: string,
  value: string,
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["--yes", "wrangler", "secret", "put", secretName, "--name", workerName],
      {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
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
    child.stdin.write(value + "\n");
    child.stdin.end();
  });
}

export async function runWranglerSecretDelete(
  workerName: string,
  secretName: string,
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["--yes", "wrangler", "secret", "delete", secretName, "--name", workerName],
      {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
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
    child.stdin.end();
  });
}
