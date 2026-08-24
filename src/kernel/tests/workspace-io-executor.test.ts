import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeKernelCommand } from "../runtime.ts";

/*
<MODULE_CONTRACT>
<purpose>
  RFC-0267: proves the executor's IO-adapter selection is load-bearing, not
  just the adapters in isolation. A command that (mistakenly) declares
  mutatesState: false but attempts a write via context.io is caught by the
  executor's read-only adapter and fails loudly with KERNEL-META-01 — this is
  the "test harness runs every mutatesState: false command under read-only
  IO" mechanism the RFC requires, demonstrated end-to-end against a fixture
  command standing in for "a previously mislabeled command found".
</purpose>
</MODULE_CONTRACT>
*/

async function fixtureWorkspace(): Promise<{ root: string }> {
  const root = await mkdtemp(join(tmpdir(), "workspace-io-executor-"));
  const toolsRoot = join(root, "tools");
  await mkdir(toolsRoot, { recursive: true });
  await writeFile(join(root, "package.json"), "{}\n", "utf8");
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8");
  await writeFile(
    join(toolsRoot, "kernel.config.mjs"),
    `
export default {
  modules: [{
    name: "fixture",
    version: "0.0.0",
    register(registry) {
      registry.registerCommand({
        name: "fixture.mislabeled.command",
        description: "declares mutatesState: false but actually writes — the bug this test finds",
        scope: "workspace",
        mutatesState: false,
        async execute(_input, context) {
          await context.io.writeFile("${join(root, "should-not-exist.txt").replace(/\\/g, "\\\\")}", "oops");
          return { exitCode: 0 };
        },
      });
      registry.registerCommand({
        name: "fixture.honest.readonly.command",
        description: "correctly declares mutatesState: false and never writes",
        scope: "workspace",
        mutatesState: false,
        async execute(_input, context) {
          const exists = await context.io.exists("${join(root, "package.json").replace(/\\/g, "\\\\")}");
          return { exitCode: 0, data: { exists } };
        },
      });
      registry.registerCommand({
        name: "fixture.writes.file.command",
        description: "mutating command that writes via context.io, for RFC-0326 filesModified tests",
        scope: "workspace",
        mutatesState: true,
        async execute(_input, context) {
          const docs = "${join(root, "docs").replace(/\\/g, "\\\\")}";
          const target = "${join(root, "docs", "generated.txt").replace(/\\/g, "\\\\")}";
          // Use a single writeFile call; createDefaultIO's writeFile already
          // ensures parent directories exist (recursive mkdir), so we do not
          // emit a separate mkdir intent.
          await context.io.writeFile(target, "generated content");
          return { exitCode: 0, data: { wrote: target } };
        },
      });
    },
  }],
};
`,
    "utf8",
  );
  return { root };
}

test("executor: a mislabeled mutatesState: false command that writes via context.io fails with KERNEL-META-01", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const report = await executeKernelCommand({
      workspaceRoot: root,
      commandName: "fixture.mislabeled.command",
      outputFormat: "json",
    });
    const single = Array.isArray(report) ? report[0]! : report;
    expect(single.ok).toBe(false);
    expect(single.exitCode).toBe(1);
    expect(single.summary ?? "").toMatch(/KERNEL-META-01/);
    expect(single.summary ?? "").toMatch(/fixture\.mislabeled\.command/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executor: an honestly-declared mutatesState: false command runs cleanly under the read-only adapter", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const report = await executeKernelCommand({
      workspaceRoot: root,
      commandName: "fixture.honest.readonly.command",
      outputFormat: "json",
    });
    const single = Array.isArray(report) ? report[0]! : report;
    expect(single.ok).toBe(true);
    expect((single.data as { exists: boolean })?.exists).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// RFC-0326: end-to-end tests that the executor surfaces filesModified on the
// execution report for both real and dry runs.
test("executor: real mutating command reports filesModified as workspace-root-relative paths", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const report = await executeKernelCommand({
      workspaceRoot: root,
      commandName: "fixture.writes.file.command",
      outputFormat: "json",
    });
    const single = Array.isArray(report) ? report[0]! : report;
    expect(single.ok).toBe(true);
    expect(single.filesModified).toEqual(["docs/generated.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executor: dry-run mutating command reports filesModified without touching disk", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const report = await executeKernelCommand({
      workspaceRoot: root,
      commandName: "fixture.writes.file.command",
      outputFormat: "json",
      dryRun: true,
    });
    const single = Array.isArray(report) ? report[0]! : report;
    expect(single.ok).toBe(true);
    expect(single.filesModified).toEqual(["docs/generated.txt"]);
    // File must NOT have been written to disk during dry-run.
    let fileExists = false;
    try {
      await import("node:fs/promises").then((fs) => fs.access(join(root, "docs", "generated.txt")));
      fileExists = true;
    } catch {
      fileExists = false;
    }
    expect(fileExists).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executor: mutatesState: false command reports empty filesModified", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const report = await executeKernelCommand({
      workspaceRoot: root,
      commandName: "fixture.honest.readonly.command",
      outputFormat: "json",
    });
    const single = Array.isArray(report) ? report[0]! : report;
    expect(single.ok).toBe(true);
    expect(single.filesModified).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
