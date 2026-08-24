import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import {
  discoverSiteWorkspaces,
  executeKernelPipeline,
  findWorkspaceRoot,
  parseKernelArgv,
} from "../index.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    Verify foundational kernel runtime behaviors such as argv parsing, app discovery, and workspace root resolution.
  </purpose>
  <responsibilities>
    <item>Assert stable parsing semantics for mixed args and flags.</item>
    <item>Assert kernel app discovery from a temporary workspace fixture.</item>
    <item>Assert upward workspace-root resolution.</item>
  </responsibilities>
  <non-goals>
    <item>Do not cover app-specific command behavior here.</item>
  </non-goals>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="argv-test">Flag and args parsing expectations.</entry>
  <entry key="discovery-test">Kernel app discovery fixture test.</entry>
  <entry key="workspace-root-test">Workspace root traversal test.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>Backfill reduced Compass scaffolding on the kernel runtime tests file.</item>
  <item>RFC-0246: Pin targetless workspace pipeline execution from root kernel config.</item>
</CHANGE_SUMMARY>
*/

test("parseKernelArgv separates args and flags", () => {
  const parsed = parseKernelArgv([
    "--root",
    "src",
    "--dry-run",
    "alpha",
    "--tag=beta",
    "--",
    "tail",
  ]);

  expect(parsed.diagnostics.length).toBe(2);
  expect(parsed.diagnostics[0]?.ruleId).toBe("KERNEL-ARG-01");
  expect(parsed.diagnostics[1]?.ruleId).toBe("KERNEL-ARG-01");
  expect(parsed.flags.root).toBe("src");
  expect(parsed.flags["dry-run"]).toBe(true);
  expect(parsed.flags.tag).toBe("beta");
});

test("discoverSiteWorkspaces finds configured apps", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "werkstatt-workspace-"));
  const appRoot = path.join(workspaceRoot, "apps", "demo");
  const toolsRoot = path.join(appRoot, "tools");

  await fs.mkdir(toolsRoot, { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, "package.json"), "{}\n", "utf8");
  await fs.writeFile(
    path.join(workspaceRoot, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(appRoot, "package.json"),
    JSON.stringify({ name: "@demo/site" }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(toolsRoot, "kernel.config.js"),
    "export default { modules: [] };\n",
    "utf8",
  );

  const sites = await discoverSiteWorkspaces(workspaceRoot);

  expect(sites.length).toBe(1);
  expect(sites[0]?.name).toBe("demo");
  expect(sites[0]?.packageName).toBe("@demo/site");
  expect(sites[0]?.configPath?.endsWith("kernel.config.js")).toBeTruthy();
});

test("findWorkspaceRoot walks upward to the pnpm workspace", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "werkstatt-root-"));
  const nestedDirectory = path.join(workspaceRoot, "apps", "demo", "src");

  await fs.mkdir(nestedDirectory, { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, "package.json"), "{}\n", "utf8");
  await fs.writeFile(
    path.join(workspaceRoot, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n",
    "utf8",
  );

  const resolved = await findWorkspaceRoot(nestedDirectory);
  expect(resolved).toBe(workspaceRoot);
});

test("executeKernelPipeline runs workspace pipelines without an app target", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "werkstatt-pipeline-"));
  const toolsRoot = path.join(workspaceRoot, "tools");

  await fs.mkdir(toolsRoot, { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, "package.json"), "{}\n", "utf8");
  await fs.writeFile(
    path.join(workspaceRoot, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(toolsRoot, "kernel.config.mjs"),
    `
export default {
  modules: [{
    name: "workspace-fixture",
    version: "0.0.0",
    register(registry) {
      registry.registerCommand({
        name: "workspace.ok",
        description: "fixture",
        scope: "workspace",
        expectedDurationMs: 1,
        timeoutMs: 1000,
        execute() {
          return { exitCode: 0, summary: "workspace.ok" };
        },
      });
      registry.registerCommand({
        name: "workspace.fail",
        description: "fixture",
        scope: "workspace",
        execute() {
          return { exitCode: 1, summary: "workspace.fail" };
        },
      });
      registry.registerCommand({
        name: "workspace.timeout",
        description: "fixture",
        scope: "workspace",
        timeoutMs: 10,
        execute() {
          return new Promise(() => {});
        },
      });
      registry.registerCommand({
        name: "app.only",
        description: "fixture",
        scope: "app",
        execute() {
          return { exitCode: 0, summary: "app.only" };
        },
      });
    },
  }],
  pipelines: {
    "workspace.good": [{ command: "workspace.ok" }],
    "workspace.fail": [{ command: "workspace.fail" }],
    "workspace.timeout": [{ command: "workspace.timeout" }],
    "workspace.skipped": [{ command: "workspace.ok", skip: true, skipReason: "fixture skip" }],
    "workspace.bad": [{ command: "app.only" }],
  },
};
`,
    "utf8",
  );

  const report = await executeKernelPipeline({
    workspaceRoot,
    pipelineName: "workspace.good",
    outputFormat: "json",
  });

  expect(Array.isArray(report)).toBe(false);
  expect(Array.isArray(report) ? undefined : report.ok).toBe(true);
  expect(Array.isArray(report) ? undefined : report.siteName).toBe(undefined);
  expect(Array.isArray(report) ? undefined : report.steps[0]?.commandName).toBe("workspace.ok");
  expect(Array.isArray(report) ? undefined : report.steps[0]?.timing.exceededTimeout).toBe(false);
  expect(Array.isArray(report) ? undefined : typeof report.timing.totalDurationMs).toBe("number");
  expect(Array.isArray(report) ? undefined : report.timing.slowestSteps[0]?.command).toBe(
    "workspace.ok",
  );

  const failedReport = await executeKernelPipeline({
    workspaceRoot,
    pipelineName: "workspace.fail",
    outputFormat: "json",
  });
  expect(Array.isArray(failedReport) ? undefined : failedReport.ok).toBe(false);
  expect(Array.isArray(failedReport) ? undefined : failedReport.timing.failedStep).toBe(
    "workspace.fail",
  );
  expect(
    Array.isArray(failedReport) ? undefined : failedReport.timing.slowestSteps[0]?.status,
  ).toBe("fail");

  const skippedReport = await executeKernelPipeline({
    workspaceRoot,
    pipelineName: "workspace.skipped",
    outputFormat: "json",
  });
  expect(Array.isArray(skippedReport) ? undefined : skippedReport.ok).toBe(true);
  expect(
    Array.isArray(skippedReport) ? undefined : skippedReport.timing.slowestSteps[0]?.status,
  ).toBe("skipped");

  const timeoutReport = await executeKernelPipeline({
    workspaceRoot,
    pipelineName: "workspace.timeout",
    outputFormat: "json",
  });
  expect(Array.isArray(timeoutReport) ? undefined : timeoutReport.ok).toBe(false);
  expect(Array.isArray(timeoutReport) ? undefined : timeoutReport.timing.timeoutCount).toBe(1);
  expect(
    Array.isArray(timeoutReport) ? undefined : timeoutReport.timing.slowestSteps[0]?.status,
  ).toBe("timeout");

  await expect(() =>
    executeKernelPipeline({
      workspaceRoot,
      pipelineName: "workspace.bad",
      outputFormat: "json",
    }),
  ).rejects.toThrow(/cannot execute app-scoped step/);
});
