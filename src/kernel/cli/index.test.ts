/*
<MODULE_CONTRACT>
<purpose>RFC-1309: unit tests for --quiet/--batch CLI flags, the batch runner, and quiet preamble gating in registry/config loaders.</purpose>
<non-goals>
  <item>Do not boot a real workspace registry — registry behavior is asserted through buildRegistry's own stderr writes on a stub config.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>

<CHANGE_SUMMARY>
  <item>RFC-1309: AC-1/2/3/5 coverage — quiet preamble gating, sequential batch execution over one registry boot, failure aggregation naming the entry, manifest validation before any execution.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to internals beyond the public surface under test

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { KernelExecutionReport, ModuleExport } from "@warpgogol/werkstatt-shared/kernel";
import {
  COMMON_CLI_FLAG_NAMES,
  consumeCommonFlags,
  isJsonFlagToken,
  argvRequestsHelp,
} from "./flags.ts";
import {
  assertBatchHasNoPositional,
  BatchUsageError,
  runBatch,
  type BatchExecutor,
} from "./batch.ts";
import { buildRegistry } from "../runtime/registry.ts";
import { clearRegistryCache, getOrBuildRegistry } from "../runtime/registry-cache.ts";
import { loadKernelAppConfig } from "../discovery.ts";
import type { DiscoveredSiteWorkspace } from "@warpgogol/werkstatt-shared/kernel";

function makeReport(commandName: string, exitCode: number): KernelExecutionReport {
  return {
    commandName,
    exitCode,
    ok: exitCode === 0,
    summary: `${commandName} ${exitCode === 0 ? "passed" : "failed"}`,
    metadata: { name: commandName } as KernelExecutionReport["metadata"],
    logs: [],
    timing: { durationMs: 1, exceededTimeout: false },
    filesModified: [],
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "rfc-1309-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeManifest(dir: string, name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe("consumeCommonFlags — RFC-1309 flags", () => {
  it("parses --quiet, --batch <path>, and --stop-on-fail", () => {
    const flags = consumeCommonFlags(["--quiet", "--batch", ".werkstatt/v.yaml", "--stop-on-fail"]);
    expect(flags.quiet).toBe(true);
    expect(flags.batch).toBe(".werkstatt/v.yaml");
    expect(flags.stopOnFail).toBe(true);
    expect(flags.remaining).toEqual([]);
  });

  it("parses --batch=<path> and leaves the positional command in remaining", () => {
    const flags = consumeCommonFlags(["rfc.validate", "--batch=m.yaml", "--id", "RFC-1"]);
    expect(flags.batch).toBe("m.yaml");
    expect(flags.remaining).toEqual(["rfc.validate", "--id", "RFC-1"]);
  });

  it("keeps existing common flags intact alongside the new ones", () => {
    const flags = consumeCommonFlags([
      "--site",
      "alpha",
      "--dry-run",
      "--json",
      "--quiet",
      "--batch",
      "b.yaml",
    ]);
    expect(flags.siteName).toBe("alpha");
    expect(flags.dryRun).toBe(true);
    expect(flags.outputFormat).toBe("json");
    expect(flags.quiet).toBe(true);
    expect(flags.batch).toBe("b.yaml");
  });

  it("COMMON_CLI_FLAG_NAMES stays in sync with the envelope parsers (RFC-1313 drift guard)", () => {
    // Every listed name must be consumed by exactly one envelope surface:
    // consumeCommonFlags, isJsonFlagToken, or argvRequestsHelp. A flag added
    // to a parser without updating the const fails here, and vice versa.
    for (const name of COMMON_CLI_FLAG_NAMES) {
      if (name === "h") {
        expect(argvRequestsHelp(["-h"])).toBe(true);
        continue;
      }
      if (name === "help") {
        expect(argvRequestsHelp(["--help"])).toBe(true);
        continue;
      }
      if (name === "json" || name === "output") {
        expect(isJsonFlagToken(`--${name}`)).toBe(true);
        continue;
      }
      const valueFlags = new Set(["site", "concurrency", "batch"]);
      const argv = valueFlags.has(name) ? [`--${name}`, "4"] : [`--${name}`];
      const flags = consumeCommonFlags(argv);
      expect(flags.remaining).toEqual([]);
    }
  });
});

describe("--batch + positional command rejection", () => {
  it("rejects a positional command name alongside --batch", () => {
    expect(() => assertBatchHasNoPositional(["rfc.validate", "--id", "RFC-1"])).toThrow(
      BatchUsageError,
    );
  });

  it("accepts an empty remaining argv", () => {
    expect(() => assertBatchHasNoPositional([])).not.toThrow();
  });
});

describe("runBatch manifest validation — AC-5", () => {
  const noExecute = vi.fn<BatchExecutor>();

  beforeEach(() => {
    noExecute.mockClear();
  });

  it("rejects a missing manifest path before running any command", async () => {
    await expect(
      runBatch({
        workspaceRoot: "/ws",
        manifestPath: "/does/not/exist.yaml",
        globals: {},
        execute: noExecute,
      }),
    ).rejects.toThrow(BatchUsageError);
    expect(noExecute).not.toHaveBeenCalled();
  });

  it("rejects unparseable YAML before running any command", async () => {
    await withTempDir(async (dir) => {
      const manifest = await writeManifest(dir, "bad.yaml", "commands: [unclosed\n  - :");
      await expect(
        runBatch({ workspaceRoot: "/ws", manifestPath: manifest, globals: {}, execute: noExecute }),
      ).rejects.toThrow(BatchUsageError);
      expect(noExecute).not.toHaveBeenCalled();
    });
  });

  it("rejects an empty commands array before running any command", async () => {
    await withTempDir(async (dir) => {
      const manifest = await writeManifest(dir, "empty.yaml", "commands: []\n");
      await expect(
        runBatch({ workspaceRoot: "/ws", manifestPath: manifest, globals: {}, execute: noExecute }),
      ).rejects.toThrow(/non-empty `commands` array/);
      expect(noExecute).not.toHaveBeenCalled();
    });
  });

  it("rejects a manifest without commands before running any command", async () => {
    await withTempDir(async (dir) => {
      const manifest = await writeManifest(dir, "no-commands.yaml", "steps: []\n");
      await expect(
        runBatch({ workspaceRoot: "/ws", manifestPath: manifest, globals: {}, execute: noExecute }),
      ).rejects.toThrow(BatchUsageError);
      expect(noExecute).not.toHaveBeenCalled();
    });
  });
});

describe("runBatch execution — AC-2/AC-3", () => {
  it("runs every manifest entry sequentially through the executor (AC-2)", async () => {
    await withTempDir(async (dir) => {
      const manifest = await writeManifest(
        dir,
        "batch.yaml",
        [
          "commands:",
          '  - run: "rfc.validate --id RFC-1309"',
          '  - argv: ["cosmic.name.unique", "--all"]',
          '  - run: "rfc.verification.emit --id RFC-1309"',
          "",
        ].join("\n"),
      );
      const calls: string[] = [];
      const execute = vi.fn<BatchExecutor>(async (options) => {
        calls.push(
          [
            options.commandName,
            ...(options.argv ?? []),
            ...(options.allSites ? ["[--all]"] : []),
          ].join(" "),
        );
        return makeReport(options.commandName, 0);
      });
      const { report, exitCode } = await runBatch({
        workspaceRoot: "/ws",
        manifestPath: manifest,
        globals: { outputFormat: "json" },
        execute,
      });
      expect(calls).toEqual([
        "rfc.validate --id RFC-1309",
        "cosmic.name.unique [--all]",
        "rfc.verification.emit --id RFC-1309",
      ]);
      expect(exitCode).toBe(0);
      expect(report.command).toBe("werkstatt.run.batch");
      expect(report.status).toBe("pass");
      expect(report.results).toHaveLength(3);
      expect(report.results.every((r) => r.status === "pass" && r.exitCode === 0)).toBe(true);
    });
  });

  it("keeps the registry build process-cached across batch entries (AC-2 single boot)", async () => {
    clearRegistryCache();
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      });
    try {
      const mod: ModuleExport = { name: "probe-mod" } as ModuleExport;
      const config = { modules: [mod] };
      await getOrBuildRegistry("rfc-1309-test", config);
      await getOrBuildRegistry("rfc-1309-test", config);
      const loads = writes.filter((line) => line.includes("loading module probe-mod"));
      const hits = writes.filter((line) => line.includes("cache hit"));
      expect(loads).toHaveLength(1);
      expect(hits).toHaveLength(1);
    } finally {
      spy.mockRestore();
      clearRegistryCache();
    }
  });

  it("aggregates a failing entry, names it, and exits non-zero (AC-3)", async () => {
    await withTempDir(async (dir) => {
      const manifest = await writeManifest(
        dir,
        "batch.yaml",
        [
          "commands:",
          '  - run: "first.ok"',
          '  - run: "second.fails --flag x"',
          '  - run: "third.ok"',
          "",
        ].join("\n"),
      );
      const execute = vi.fn<BatchExecutor>(async (options) =>
        makeReport(options.commandName, options.commandName === "second.fails" ? 2 : 0),
      );
      const stdout: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdout.push(args.map(String).join(" "));
      });
      try {
        const { report, exitCode } = await runBatch({
          workspaceRoot: "/ws",
          manifestPath: manifest,
          globals: {},
          execute,
        });
        expect(exitCode).toBe(2);
        expect(report.status).toBe("fail");
        const failing = report.results.find((r) => r.status !== "pass");
        expect(failing?.run).toBe("second.fails --flag x");
        expect(failing?.exitCode).toBe(2);
        expect(execute).toHaveBeenCalledTimes(3);
        expect(
          stdout.some((line) => line.includes("[batch] failed: second.fails --flag x (exit 2)")),
          "pretty summary must name the failing entry",
        ).toBe(true);
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  it("stops after the first failure under --stop-on-fail", async () => {
    await withTempDir(async (dir) => {
      const manifest = await writeManifest(
        dir,
        "batch.yaml",
        ["commands:", '  - run: "first.fails"', '  - run: "second.skipped"', ""].join("\n"),
      );
      const execute = vi.fn<BatchExecutor>(async (options) => makeReport(options.commandName, 1));
      const { report, exitCode } = await runBatch({
        workspaceRoot: "/ws",
        manifestPath: manifest,
        globals: { stopOnFail: true, outputFormat: "json" },
        execute,
      });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(exitCode).toBe(1);
      expect(report.results).toHaveLength(1);
    });
  });

  it("records an executor throw as an entry error and continues", async () => {
    await withTempDir(async (dir) => {
      const manifest = await writeManifest(
        dir,
        "batch.yaml",
        ["commands:", '  - run: "no.such.command"', '  - run: "after.ok"', ""].join("\n"),
      );
      const execute = vi.fn<BatchExecutor>(async (options) => {
        if (options.commandName === "no.such.command") {
          throw new Error("Kernel command `no.such.command` is not registered.");
        }
        return makeReport(options.commandName, 0);
      });
      const { report, exitCode } = await runBatch({
        workspaceRoot: "/ws",
        manifestPath: manifest,
        globals: { outputFormat: "json" },
        execute,
      });
      expect(report.results[0]?.status).toBe("error");
      expect(report.results[0]?.exitCode).toBe(1);
      expect(report.results[1]?.status).toBe("pass");
      expect(exitCode).toBe(1);
    });
  });

  it("lets per-entry flags override globals for that entry only", async () => {
    await withTempDir(async (dir) => {
      const manifest = await writeManifest(
        dir,
        "batch.yaml",
        ["commands:", '  - run: "cmd.a --site alpha --dry-run"', '  - run: "cmd.b"', ""].join("\n"),
      );
      const seen: Record<string, unknown>[] = [];
      const execute = vi.fn<BatchExecutor>(async (options) => {
        seen.push({
          commandName: options.commandName,
          siteName: options.siteName,
          dryRun: options.dryRun,
        });
        return makeReport(options.commandName, 0);
      });
      await runBatch({
        workspaceRoot: "/ws",
        manifestPath: manifest,
        globals: { siteName: "global-site", outputFormat: "json" },
        execute,
      });
      expect(seen[0]).toEqual({ commandName: "cmd.a", siteName: "alpha", dryRun: true });
      expect(seen[1]).toEqual({ commandName: "cmd.b", siteName: "global-site", dryRun: false });
    });
  });

  it("supports the argv entry form for values containing spaces", async () => {
    await withTempDir(async (dir) => {
      const manifest = await writeManifest(
        dir,
        "batch.yaml",
        'commands:\n  - argv: ["ecosystem.commit", "--message", "has a space"]\n',
      );
      const execute = vi.fn<BatchExecutor>(async (options) => makeReport(options.commandName, 0));
      const { report } = await runBatch({
        workspaceRoot: "/ws",
        manifestPath: manifest,
        globals: { outputFormat: "json" },
        execute,
      });
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ commandName: "ecosystem.commit" }),
      );
      expect(report.results[0]?.run).toBe("ecosystem.commit --message has a space");
    });
  });
});

describe("quiet preamble gating — AC-1", () => {
  beforeEach(() => clearRegistryCache());
  afterEach(() => clearRegistryCache());

  function captureStderr(): { writes: string[]; restore: () => void } {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      });
    return { writes, restore: () => spy.mockRestore() };
  }

  it("suppresses [registry] module-loading and cache-hit lines under quiet", async () => {
    const { writes, restore } = captureStderr();
    try {
      const mod: ModuleExport = { name: "quiet-probe" } as ModuleExport;
      const config = { modules: [mod] };
      await getOrBuildRegistry("rfc-1309-quiet", config, { quiet: true });
      await getOrBuildRegistry("rfc-1309-quiet", config, { quiet: true });
      expect(writes.filter((line) => line.includes("[registry]"))).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("still emits [registry] lines without quiet (control)", async () => {
    const { writes, restore } = captureStderr();
    try {
      const mod: ModuleExport = { name: "loud-probe" } as ModuleExport;
      await buildRegistry({ modules: [mod] });
      expect(writes.some((line) => line.includes("loading module loud-probe"))).toBe(true);
    } finally {
      restore();
    }
  });

  it("suppresses [config] lines on the site-config loader under quiet", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "kernel.config.ts");
      await writeFile(configPath, "export default { modules: [] };\n");
      const site: DiscoveredSiteWorkspace = {
        name: "quiet-site",
        directory: dir,
        toolsDirectory: dir,
        configPath,
      };
      const { writes, restore } = captureStderr();
      try {
        await loadKernelAppConfig(site, { quiet: true });
        expect(writes.filter((line) => line.includes("[config]"))).toHaveLength(0);
      } finally {
        restore();
      }
    });
  });
});

describe("json flag detection", () => {
  it("treats --output and --json variants as json", () => {
    for (const token of ["--json", "--json=1", "--output", "--output=json"]) {
      expect(isJsonFlagToken(token)).toBe(true);
    }
    expect(isJsonFlagToken("--pretty")).toBe(false);
  });
});
