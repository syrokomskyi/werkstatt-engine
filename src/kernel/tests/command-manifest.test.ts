import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import {
  buildCommandManifest,
  runCommandManifestGenerate,
  runCommandManifestValidate,
  manifestFilePath,
  CommandManifestDedupError,
} from "../command-manifest.ts";
import { listStaticCommandSurface } from "../runtime.ts";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  ModuleExport,
} from "@warpgogol/werkstatt-shared/kernel";

/*
<MODULE_CONTRACT>
<purpose>
  RFC-0266: fixture tests for the command manifest generator/validator,
  written before wiring docs.commands.generate/ecosystem.manifest.generate to
  consume it. Generator determinism (two runs, identical bytes) and validator
  red on a mutated committed manifest (CMD-MAN-01).
</purpose>
</MODULE_CONTRACT>
*/

const logger = {
  section() {},
  info() {},
  warn() {},
  error() {},
  success() {},
  getEvents() {
    return [];
  },
};

const input = { argv: [], flags: {} } as unknown as KernelCommandInput;

function ctx(root: string): KernelRuntimeContext {
  return {
    workspaceRoot: root,
    siteExplicit: false,
    logger,
    dryRun: false,
    outputFormat: "json",
  } as unknown as KernelRuntimeContext;
}

async function fixtureWorkspace(): Promise<{ root: string }> {
  const root = await mkdtemp(join(tmpdir(), "command-manifest-"));
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
        name: "fixture.generate",
        modulePath: "test",
        description: "fixture generator",
        scope: "workspace",
        mutatesState: true,
        writes: ["docs/fixture.generated.yaml"],
        execute() { return { exitCode: 0 }; },
      },
      {
        name: "fixture.validate",
        modulePath: "test",
        description: "fixture validator",
        scope: "workspace",
        execute() { return { exitCode: 0 }; },
      },
    ],
    pipelines: [
      { name: "fixture.check", steps: [{ command: "fixture.generate" }, { command: "fixture.validate" }] },
    ],
  }],
};
`,
    "utf8",
  );
  return { root };
}

test("buildCommandManifest: determinism — two runs produce identical bytes", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const first = await buildCommandManifest(root);
    const second = await buildCommandManifest(root);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.commands.some((c) => c.name === "fixture.generate")).toBeTruthy();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildCommandManifest: derives pipeline membership", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const manifest = await buildCommandManifest(root);
    const entry = manifest.commands.find((c) => c.name === "fixture.generate");
    expect(entry).toBeTruthy();
    expect(entry?.pipelines.includes("fixture.check")).toBeTruthy();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runCommandManifestGenerate then runCommandManifestValidate: green on a freshly-generated manifest", async () => {
  const { root } = await fixtureWorkspace();
  try {
    await runCommandManifestGenerate(input, ctx(root));
    const result = await runCommandManifestValidate(input, ctx(root));
    const diags = (result.data as { diagnostics: Array<{ ruleId: string }> }).diagnostics;
    expect(!diags.some((d) => d.ruleId === "CMD-MAN-01")).toBeTruthy();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CMD-MAN-01: fails when the committed manifest is mutated (stale contentHash)", async () => {
  const { root } = await fixtureWorkspace();
  try {
    await runCommandManifestGenerate(input, ctx(root));
    const raw = await readFile(manifestFilePath(root), "utf8");
    const mutated = yamlParse(raw);
    // Simulate a hand-edit: the declared contentHash no longer matches reality —
    // exactly what CMD-MAN-01's hash comparison exists to catch.
    mutated.meta.contentHash = "0".repeat(64);
    await writeFile(manifestFilePath(root), yamlStringify(mutated), "utf8");

    const result = await runCommandManifestValidate(input, ctx(root));
    const diags = (result.data as { diagnostics: Array<{ ruleId: string }> }).diagnostics;
    expect(diags.some((d) => d.ruleId === "CMD-MAN-01")).toBeTruthy();
    expect(result.exitCode).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CMD-MAN-02: warns when a command declares mutatesState but no writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "command-manifest-nowrites-"));
  try {
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
        name: "fixture.nowrites.generate",
        modulePath: "test",
        description: "fixture generator missing writes",
        scope: "workspace",
        mutatesState: true,
        execute() { return { exitCode: 0 }; },
      },
    ],
    pipelines: [],
  }],
};
`,
      "utf8",
    );
    await runCommandManifestGenerate(input, ctx(root));
    const result = await runCommandManifestValidate(input, ctx(root));
    const diags = (result.data as { diagnostics: Array<{ ruleId: string; message: string }> })
      .diagnostics;
    expect(
      diags.some(
        (d) => d.ruleId === "CMD-MAN-02" && d.message.includes("fixture.nowrites.generate"),
      ),
    ).toBeTruthy();
    expect(result.exitCode ?? 0).toBe(0); // warning-only, does not fail the build
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── RFC-1147: static command surface ─────────────────────────────────────────

function siteModuleFixture(overrides: Partial<ModuleExport> = {}): ModuleExport {
  return {
    name: "fixture-site-module",
    version: "0.0.0",
    declarations: [],
    commands: [
      {
        name: "site.only.command",
        modulePath: "test-site-module",
        description: "site-module-only command",
        scope: "app",
        execute() {
          return { exitCode: 0 };
        },
      },
    ],
    pipelines: [{ name: "site.pipeline", steps: [{ command: "site.only.command" }] }],
    ...overrides,
  } as ModuleExport;
}

test("listStaticCommandSurface: merges workspace + injected site modules with provider tags", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const surface = await listStaticCommandSurface(root, {
      "fixture-site": async () => siteModuleFixture(),
    });
    const workspaceCmd = surface.commands.find((c) => c.name === "fixture.generate");
    const siteCmd = surface.commands.find((c) => c.name === "site.only.command");
    expect(workspaceCmd?.provider).toBe("workspace");
    expect(siteCmd?.provider).toBe("site-module");
    expect(surface.pipelines["fixture.check"]).toEqual(["fixture.generate", "fixture.validate"]);
    expect(surface.pipelines["site.pipeline"]).toEqual(["site.only.command"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildCommandManifest: providers[] + siteScope reflect the static surface", async () => {
  const { root } = await fixtureWorkspace();
  try {
    const manifest = await buildCommandManifest(root, {
      "fixture-site": async () => siteModuleFixture(),
    });
    const workspaceEntry = manifest.commands.find((c) => c.name === "fixture.generate");
    const siteEntry = manifest.commands.find((c) => c.name === "site.only.command");
    expect(workspaceEntry?.providers).toEqual(["workspace"]);
    expect(workspaceEntry?.siteScope).toBe(false);
    expect(siteEntry?.providers).toEqual(["site-module"]);
    expect(siteEntry?.siteScope).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CMD-MAN-04: identical declarations across providers dedup to one entry", async () => {
  const { root } = await fixtureWorkspace();
  try {
    // Same name + identical semantics as the workspace fixture.generate —
    // must merge into a single entry with both providers, not throw.
    const manifest = await buildCommandManifest(root, {
      "fixture-site": async () =>
        siteModuleFixture({
          commands: [
            {
              name: "fixture.generate",
              modulePath: "test-site-module",
              description: "fixture generator",
              scope: "workspace",
              mutatesState: true,
              writes: ["docs/fixture.generated.yaml"],
              execute() {
                return { exitCode: 0 };
              },
            },
          ],
        }),
    });
    const entries = manifest.commands.filter((c) => c.name === "fixture.generate");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.providers).toEqual(["site-module", "workspace"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CMD-MAN-04: divergent same-name declarations fail closed", async () => {
  const { root } = await fixtureWorkspace();
  try {
    await expect(
      buildCommandManifest(root, {
        "fixture-site": async () =>
          siteModuleFixture({
            commands: [
              {
                name: "fixture.generate",
                modulePath: "test-site-module",
                description: "a DIFFERENT description — semantic divergence",
                scope: "app",
                execute() {
                  return { exitCode: 0 };
                },
              },
            ],
          }),
      }),
    ).rejects.toThrow(CommandManifestDedupError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
