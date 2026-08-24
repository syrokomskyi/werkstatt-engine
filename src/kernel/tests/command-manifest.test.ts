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
} from "../command-manifest.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "../types.ts";

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
    register(registry) {
      registry.registerCommand({
        name: "fixture.generate",
        description: "fixture generator",
        scope: "workspace",
        mutatesState: true,
        writes: ["docs/fixture.generated.yaml"],
        execute() { return { exitCode: 0 }; },
      });
      registry.registerCommand({
        name: "fixture.validate",
        description: "fixture validator",
        scope: "workspace",
        execute() { return { exitCode: 0 }; },
      });
    },
  }],
  pipelines: {
    "fixture.check": [{ command: "fixture.generate" }, { command: "fixture.validate" }],
  },
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
    register(registry) {
      registry.registerCommand({
        name: "fixture.nowrites.generate",
        description: "fixture generator missing writes",
        scope: "workspace",
        mutatesState: true,
        execute() { return { exitCode: 0 }; },
      });
    },
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
