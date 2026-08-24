import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProbe, validateAcceptanceShape, type AcceptanceProbe } from "@warpgogol/forge/os/rfc";
import type { CommandRegistry } from "@warpgogol/forge";

/*
<MODULE_CONTRACT>
<purpose>
  RFC-0268: unit tests for the acceptance probe schema validator and runner,
  written before the RFC's own probes are added. Each probe kind gets a red
  and a green fixture; malformed probe shapes produce validation issues; the
  "run" probe rejects any command not prefixed with "werkstatt "..
</purpose>
</MODULE_CONTRACT>
*/

test("validateAcceptanceShape: absent acceptance is valid (optional field)", () => {
  expect(validateAcceptanceShape(undefined)).toEqual([]);
});

test("validateAcceptanceShape: non-array value is invalid", () => {
  const issues = validateAcceptanceShape({ probe: "run" });
  expect(issues.length).toBe(1);
});

test("validateAcceptanceShape: unknown probe kind is flagged", () => {
  const issues = validateAcceptanceShape([{ probe: "shell-exec", command: "rm -rf /" }]);
  expect(issues.length).toBe(1);
  expect(issues[0]!.message).toMatch(/unknown probe kind/);
});

test("validateAcceptanceShape: run probe rejects a non-werkstatt command string", () => {
  const issues = validateAcceptanceShape([
    { probe: "run", command: "rm -rf /", expect: { exitCode: 0 } },
  ]);
  expect(issues.some((i) => i.message.includes("werkstatt "))).toBeTruthy();
});

test("validateAcceptanceShape: well-formed probes of every kind pass with zero issues", () => {
  const probes: AcceptanceProbe[] = [
    { probe: "run", command: "werkstatt run rfc.validate", expect: { exitCode: 0 } },
    { probe: "file-exists", path: "AGENTS.md" },
    { probe: "file-contains", path: "AGENTS.md", pattern: "Commit message contract" },
    { probe: "command-registered", name: "rfc.validate" },
  ];
  expect(validateAcceptanceShape(probes)).toEqual([]);
});

test("runProbe: file-exists — red then green fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "rfc-acceptance-"));
  try {
    const red = await runProbe({ probe: "file-exists", path: "does-not-exist.txt" }, root);
    expect(red.ok).toBe(false);

    await writeFile(join(root, "exists.txt"), "hi", "utf8");
    const green = await runProbe({ probe: "file-exists", path: "exists.txt" }, root);
    expect(green.ok).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runProbe: file-contains — red then green fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "rfc-acceptance-"));
  try {
    await writeFile(join(root, "doc.md"), "nothing relevant here", "utf8");
    const red = await runProbe({ probe: "file-contains", path: "doc.md", pattern: "needle" }, root);
    expect(red.ok).toBe(false);

    await writeFile(join(root, "doc.md"), "here is the needle in the haystack", "utf8");
    const green = await runProbe(
      { probe: "file-contains", path: "doc.md", pattern: "needle" },
      root,
    );
    expect(green.ok).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runProbe: command-registered — red for an unregistered name, green for a fixture-registered command", async () => {
  // A minimal fixture workspace (not the real monorepo) keeps this test fast —
  // listRegisteredKernelCommands against the full repo builds every app's
  // registry and is far too slow for a unit test.
  const root = await mkdtemp(join(tmpdir(), "rfc-acceptance-registry-"));
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
        name: "fixture.command",
        description: "fixture",
        scope: "workspace",
        execute() { return { exitCode: 0 }; },
      });
    },
  }],
};
`,
      "utf8",
    );

    const fixtureRegistry: CommandRegistry = {
      listCommandNames: () => ["fixture.command"],
      listCommands: () => [
        {
          name: "fixture.command",
          description: "fixture",
          scope: "workspace",
          provider: "workspace",
        },
      ],
      getCommand: () => undefined,
    };

    const red = await runProbe(
      { probe: "command-registered", name: "totally.not.a.real.command" },
      root,
      fixtureRegistry,
    );
    expect(red.ok).toBe(false);

    const green = await runProbe(
      { probe: "command-registered", name: "fixture.command" },
      root,
      fixtureRegistry,
    );
    expect(green.ok).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runProbe: run — a command not prefixed with "werkstatt " is rejected without executing', async () => {
  const result = await runProbe(
    { probe: "run", command: "rm -rf /", expect: { exitCode: 0 } },
    "/tmp",
  );
  expect(result.ok).toBe(false);
  expect(result.detail).toMatch(/rejected/);
});

test("runProbe: run — end-to-end against the real repo, exitCode matches expect.exitCode", async () => {
  const workspaceRoot = join(import.meta.dirname, "..", "..", "..", "..", "..");
  const result = await runProbe(
    {
      probe: "run",
      command: "werkstatt run rfc.validate --id rfc-0268",
      expect: { exitCode: 0 },
    },
    workspaceRoot,
  );
  expect(result.ok).toBe(true);
}, 180_000);
