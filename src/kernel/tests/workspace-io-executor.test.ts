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
    declarations: [],
    commands: [
      {
        name: "fixture.mislabeled.command",
        modulePath: "test",
        description: "declares mutatesState: false but actually writes — the bug this test finds",
        scope: "workspace",
        mutatesState: false,
        async execute(_input, context) {
          await context.io.writeFile("${join(root, "should-not-exist.txt").replace(/\\/g, "\\\\")}", "oops");
          return { exitCode: 0 };
        },
      },
      {
        name: "fixture.honest.readonly.command",
        modulePath: "test",
        description: "correctly declares mutatesState: false and never writes",
        scope: "workspace",
        mutatesState: false,
        async execute(_input, context) {
          const exists = await context.io.exists("${join(root, "package.json").replace(/\\/g, "\\\\")}");
          return { exitCode: 0, data: { exists } };
        },
      },
      {
        name: "fixture.writes.file.command",
        modulePath: "test",
        description: "mutating command that writes via context.io, for RFC-0326 filesModified tests",
        scope: "workspace",
        mutatesState: true,
        async execute(_input, context) {
          const docs = "${join(root, "docs").replace(/\\/g, "\\\\")}";
          const target = "${join(root, "docs", "generated.txt").replace(/\\/g, "\\\\")}";
          await context.io.writeFile(target, "generated content");
          return { exitCode: 0, data: { wrote: target } };
        },
      },
      {
        name: "fixture.manual.rendered.command",
        modulePath: "test",
        description: "emits its own renderedFiles — manual emission must win over the auto-collected map",
        scope: "workspace",
        mutatesState: true,
        async execute(_input, context) {
          const target = "${join(root, "docs", "generated.txt").replace(/\\/g, "\\\\")}";
          await context.io.writeFile(target, "auto content");
          return {
            exitCode: 0,
            data: { renderedFiles: { "docs/generated.txt": "manual", "docs/virtual.txt": "never written" } },
          };
        },
      },
      {
        name: "fixture.append.file.command",
        modulePath: "test",
        description: "writes then appends via context.io — rendered content must be the accumulated file",
        scope: "workspace",
        mutatesState: true,
        async execute(_input, context) {
          const target = "${join(root, "docs", "appended.txt").replace(/\\/g, "\\\\")}";
          await context.io.writeFile(target, "a");
          await context.io.appendFile(target, "b");
          return { exitCode: 0 };
        },
      },
      {
        name: "fixture.exec-readonly.command",
        modulePath: "test",
        description: "RFC-1176: execOnReadOnly command — io.exec passes through, fs writes still throw",
        scope: "workspace",
        mutatesState: false,
        execOnReadOnly: true,
        async execute(_input, context) {
          const r = await context.io.exec("echo", ["probe"]);
          return { exitCode: 0, data: { out: r.stdout.trim(), readonly: context.io.readonly } };
        },
      },
      {
        name: "fixture.writebaseline.command",
        modulePath: "test",
        description: "RFC-1176: mutatingFlags command — writes only under --write-baseline",
        scope: "workspace",
        mutatesState: false,
        mutatingFlags: ["write-baseline"],
        flags: {
          "write-baseline": { kind: "boolean", description: "Write the baseline file" },
        },
        async execute(input, context) {
          if (input.flags["write-baseline"] === true) {
            const target = "${join(root, "baseline.txt").replace(/\\/g, "\\\\")}";
            await context.io.writeFile(target, "baseline");
            return { exitCode: 0, data: { wrote: true, readonly: context.io.readonly } };
          }
          return { exitCode: 0, data: { wrote: false, readonly: context.io.readonly } };
        },
      },
      {
        name: "fixture.echo.flag",
        modulePath: "test",
        description: "RFC-1306: echoes input.flags — proves invoke flag serialization for all kinds",
        scope: "workspace",
        mutatesState: false,
        flags: {
          msg: { kind: "string", description: "Echo this value" },
          flag: { kind: "boolean", description: "Boolean true round-trip" },
          off: { kind: "boolean", description: "Boolean false round-trip" },
          list: { kind: "string[]", description: "Array round-trip" },
          skip: { kind: "string", description: "Must stay absent when undefined" },
        },
        async execute(input) {
          return { exitCode: 0, data: { flags: input.flags } };
        },
      },
      {
        name: "fixture.invokes.child",
        modulePath: "test",
        description: "RFC-1306: calls context.invoke on a sibling — proves the executor-populated port",
        scope: "workspace",
        mutatesState: false,
        async execute(_input, context) {
          if (!context.invoke) return { exitCode: 1, data: { invokeMissing: true } };
          const report = await context.invoke("fixture.echo.flag", {
            msg: "a=b c",
            flag: true,
            off: false,
            list: ["x", "y"],
            skip: undefined,
          });
          return {
            exitCode: 0,
            data: { childOk: report.ok, childExit: report.exitCode, flags: report.data?.flags },
          };
        },
      },
    ],
    pipelines: [],
  }],
};
`,
    "utf8",
  );
  return { root };
}

test(
  "executor: a mislabeled mutatesState: false command that writes via context.io fails with KERNEL-META-01",
  { timeout: 60_000 },
  async () => {
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
  },
);

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

// RFC-1149 follow-up: the recording adapter captures full text content, and
// the executor surfaces it as data.renderedFiles under dryRun — this is what
// makes every io-migrated generator verifiable by generated.drift.validate
// (DRIFT-02) without per-command emission blocks.
test("executor: dry-run mutating command reports renderedFiles with full content", async () => {
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
    const rendered = (single.data as { renderedFiles?: Record<string, string> })?.renderedFiles;
    expect(rendered).toEqual({ "docs/generated.txt": "generated content" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executor: command-emitted renderedFiles win over the auto-collected map", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const report = await executeKernelCommand({
      workspaceRoot: root,
      commandName: "fixture.manual.rendered.command",
      outputFormat: "json",
      dryRun: true,
    });
    const single = Array.isArray(report) ? report[0]! : report;
    const rendered = (single.data as { renderedFiles?: Record<string, string> })?.renderedFiles;
    // Manual emission overrides the same key and keeps its extra entries.
    expect(rendered?.["docs/generated.txt"]).toBe("manual");
    expect(rendered?.["docs/virtual.txt"]).toBe("never written");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// RFC-1176: execOnReadOnly lets a declared mutatesState:false command shell
// out for read-only probes while fs mutations still throw KERNEL-META-01.
test("executor: execOnReadOnly command runs io.exec under the read-only adapter", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const report = await executeKernelCommand({
      workspaceRoot: root,
      commandName: "fixture.exec-readonly.command",
      outputFormat: "json",
    });
    const single = Array.isArray(report) ? report[0]! : report;
    expect(single.ok).toBe(true);
    const data = single.data as { out: string; readonly: boolean };
    expect(data.out).toBe("probe");
    expect(data.readonly).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// RFC-1176: mutatingFlags — the declaration stays read-only for scheduling;
// a declared flag in argv upgrades the invocation to the real adapter.
test("executor: mutatingFlags command stays read-only without the flag, writes with it", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const plain = await executeKernelCommand({
      workspaceRoot: root,
      commandName: "fixture.writebaseline.command",
      outputFormat: "json",
    });
    const single = Array.isArray(plain) ? plain[0]! : plain;
    expect(single.ok).toBe(true);
    expect((single.data as { readonly: boolean }).readonly).toBe(true);

    const flagged = await executeKernelCommand({
      workspaceRoot: root,
      commandName: "fixture.writebaseline.command",
      outputFormat: "json",
      argv: ["--write-baseline"],
    });
    const flaggedSingle = Array.isArray(flagged) ? flagged[0]! : flagged;
    expect(flaggedSingle.ok).toBe(true);
    expect((flaggedSingle.data as { wrote: boolean }).wrote).toBe(true);
    await expect(
      import("node:fs/promises").then((fs) => fs.readFile(join(root, "baseline.txt"), "utf8")),
    ).resolves.toBe("baseline");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executor: dry-run renderedFiles carries accumulated append content", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const report = await executeKernelCommand({
      workspaceRoot: root,
      commandName: "fixture.append.file.command",
      outputFormat: "json",
      dryRun: true,
    });
    const single = Array.isArray(report) ? report[0]! : report;
    const rendered = (single.data as { renderedFiles?: Record<string, string> })?.renderedFiles;
    expect(rendered?.["docs/appended.txt"]).toBe("ab");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "RFC-1306: context.invoke delegates to a sibling command — flags serialize to the child's resolved input",
  { timeout: 60_000 },
  async () => {
    const { root } = await fixtureWorkspace();
    try {
      const report = await executeKernelCommand({
        workspaceRoot: root,
        commandName: "fixture.invokes.child",
        outputFormat: "json",
      });
      const single = Array.isArray(report) ? report[0]! : report;
      expect(single.ok).toBe(true);
      const data = single.data as {
        childOk: boolean;
        childExit: number;
        flags: Record<string, unknown>;
      };
      expect(data.childOk).toBe(true);
      expect(data.childExit).toBe(0);
      // Every flag kind round-trips through argv serialization: string with
      // "=" and a space, boolean true/false, string[] accumulation, and
      // undefined dropped entirely.
      expect(data.flags.msg).toBe("a=b c");
      expect(data.flags.flag).toBe(true);
      expect(data.flags.off).toBe(false);
      expect(data.flags.list).toEqual(["x", "y"]);
      expect("skip" in data.flags).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
