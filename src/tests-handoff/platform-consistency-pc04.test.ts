/*
<MODULE_CONTRACT>
  <purpose>RFC-0533: tests for PC-04 rule in platform.consistency.validate.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0533: initial PC-04 rule tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runPlatformConsistencyValidate } from "../handoff/platform-consistency.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

const execFileAsync = promisify(execFile);

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    flags: flags as Record<string, import("@warpgogol/werkstatt-engine/kernel").KernelFlagValue>,
    argv: [],
  };
}

function makeContext(root: string): KernelRuntimeContext {
  return {
    workspaceRoot: root,
    logger: {
      section: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
    dryRun: false,
  } as unknown as KernelRuntimeContext;
}

async function setupGitWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pc04-test-"));
  await mkdir(join(root, "packages", "dummy"), { recursive: true });
  await mkdir(join(root, "docs", "rfcs"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "1.0.0" }), "utf8");
  await writeFile(join(root, "packages", "dummy", "index.ts"), "export const x = 1;\n", "utf8");
  await writeFile(join(root, "uni.registry.yaml"), JSON.stringify({ entries: [] }), "utf8");
  // Init git
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

async function commitWithMessage(
  root: string,
  message: string,
  files: Record<string, string>,
): Promise<string> {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(root, relPath);
    await mkdir(join(root, ...relPath.split("/").slice(0, -1)), { recursive: true });
    await writeFile(abs, content, "utf8");
    await execFileAsync("git", ["add", relPath], { cwd: root });
  }
  await execFileAsync("git", ["commit", "-m", message, "--allow-empty"], {
    cwd: root,
    env: { ...process.env, ECOSYSTEM_COMMIT: "1" },
  });
  const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: root });
  return stdout.trim();
}

test("PC-04: platform commit without trailer produces error", async () => {
  const root = await setupGitWorkspace();
  try {
    // Commit without trailer (bypass hook via ECOSYSTEM_COMMIT=1)
    await commitWithMessage(root, "feat: change something", {
      "packages/dummy/index.ts": "export const y = 2;\n",
    });

    // PC_04_CUTOFF_SHA is now set to the real implementation commit.
    // In test workspaces, the root commit is used as fallback when the cutoff
    // SHA doesn't exist in the test repo. The new commit is after the root.
    const result = await runPlatformConsistencyValidate(makeInput({}), makeContext(root));
    const pc04 = result.data?.violations?.filter((v) => v.rule === "PC-04") ?? [];
    expect(pc04.length).toBeGreaterThan(0);
    expect(pc04[0].severity).toBe("error");
    expect(pc04[0].message).toContain("X-Platform-Bump");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PC-04: platform commit with trailer passes", async () => {
  const root = await setupGitWorkspace();
  try {
    // Commit with trailer
    await commitWithMessage(
      root,
      "feat: change something\n\nX-Platform-Bump: patch\nX-Platform-Version: 1.0.1",
      {
        "packages/dummy/index.ts": "export const y = 2;\n",
      },
    );
    const result = await runPlatformConsistencyValidate(makeInput({}), makeContext(root));
    const pc04 = result.data?.violations?.filter((v) => v.rule === "PC-04") ?? [];
    expect(pc04.length).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PC-04: non-platform commit without trailer passes", async () => {
  const root = await setupGitWorkspace();
  try {
    // Commit a docs file (non-platform scope)
    await mkdir(join(root, "docs"), { recursive: true });
    await commitWithMessage(root, "docs: update readme", {
      "docs/readme.md": "# readme\n",
    });
    const result = await runPlatformConsistencyValidate(makeInput({}), makeContext(root));
    const pc04 = result.data?.violations?.filter((v) => v.rule === "PC-04") ?? [];
    expect(pc04.length).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
