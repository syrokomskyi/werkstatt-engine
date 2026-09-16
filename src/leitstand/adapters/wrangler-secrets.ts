/*
<MODULE_CONTRACT>
  <purpose>RFC-1065: Shared wrangler secret helpers — parameterized runWranglerSecretPut and runWranglerSecretDelete for provisioning secrets on Cloudflare Workers via wrangler CLI.</purpose>


  <non-goals>
    <item>Do not interpret results or decide retry logic — that is the caller's responsibility.</item>
    <item>Do not create temporary wrangler.jsonc — the caller sets cwd appropriately.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1065: extracted from access-commands.ts as parameterized shared helpers for reuse by lagebild commands.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
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
