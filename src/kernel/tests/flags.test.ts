import { test, expect } from "vitest";
import type { KernelCommandDefinition } from "../types.ts";
import { executeKernelCommand, parseKernelArgv, resolveCommandFlags } from "../index.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0260: verify typed kernel command flag schemas — resolveCommandFlags
    resolution, error diagnostics, and the strict executeKernelCommand options guard.
  </purpose>
  <responsibilities>
    <item>Assert resolveCommandFlags parses declared boolean/string/string[] flags correctly.</item>
    <item>Assert KERNEL-FLAG-01/02/03 fire for unknown, missing-value, and missing-required flags.</item>
    <item>Assert schema-less commands still parse via the unchanged heuristic parseKernelArgv path.</item>
    <item>Assert executeKernelCommand rejects unknown option keys with a nearest-key hint (regression: commit 8b3e62ab).</item>
  </responsibilities>
  <non-goals>
    <item>Do not cover the kernel.flags.lint static scan here — see site-kernel-checks tests.</item>
  </non-goals>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="resolveCommandFlags-tests">Flag resolution: boolean/string/inline/passthrough/errors.</entry>
  <entry key="parseKernelArgv-golden-test">Schema-less commands parse unchanged.</entry>
  <entry key="executeKernelCommand-options-guard-test">Regression test for commit 8b3e62ab.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-0260: initial test suite, written before the rfc.* migration lands.</item>
</CHANGE_SUMMARY>
*/

function fixtureCommand(flags: KernelCommandDefinition["flags"]): KernelCommandDefinition {
  return {
    name: "fixture.command",
    description: "fixture",
    scope: "workspace",
    flags,
    execute() {
      return { exitCode: 0, summary: "fixture.command: ok" };
    },
  };
}

test("resolveCommandFlags: declared boolean flag never consumes the next token", () => {
  const command = fixtureCommand({
    mini: { kind: "boolean", description: "fixture boolean" },
  });
  const resolved = resolveCommandFlags(["--mini", "positional"], command);

  expect(resolved.diagnostics.length).toBe(1);
  expect(resolved.diagnostics[0]?.ruleId).toBe("KERNEL-ARG-01");
  expect(resolved.flags.mini).toBe(true);
});

test("resolveCommandFlags: unknown flag -> KERNEL-FLAG-01 listing valid flags", () => {
  const command = fixtureCommand({
    title: { kind: "string", description: "fixture string" },
  });
  const resolved = resolveCommandFlags(["--bogus-flag"], command);

  expect(resolved.diagnostics.length).toBe(1);
  expect(resolved.diagnostics[0]?.ruleId).toBe("KERNEL-FLAG-01");
  expect(resolved.diagnostics[0]?.severity).toBe("error");
  expect(resolved.diagnostics[0]?.message ?? "").toMatch(/Unknown flag "--bogus-flag"/);
  expect(resolved.diagnostics[0]?.message ?? "").toMatch(/Valid flags: /);
  expect(resolved.diagnostics[0]?.message ?? "").toMatch(/title/);
});

test("resolveCommandFlags: string flag at argv end -> KERNEL-FLAG-02", () => {
  const command = fixtureCommand({
    title: { kind: "string", description: "fixture string" },
  });
  const resolved = resolveCommandFlags(["--title"], command);

  expect(resolved.diagnostics.length).toBe(1);
  expect(resolved.diagnostics[0]?.ruleId).toBe("KERNEL-FLAG-02");
});

test("resolveCommandFlags: required flag absent -> KERNEL-FLAG-03", () => {
  const command = fixtureCommand({
    title: { kind: "string", required: true, description: "fixture required string" },
  });
  const resolved = resolveCommandFlags([], command);

  expect(resolved.diagnostics.length).toBe(1);
  expect(resolved.diagnostics[0]?.ruleId).toBe("KERNEL-FLAG-03");
  expect(resolved.diagnostics[0]?.message ?? "").toMatch(/Required flag "--title"/);
});

test("resolveCommandFlags: --flag=value inline form", () => {
  const command = fixtureCommand({
    title: { kind: "string", description: "fixture string" },
  });
  const resolved = resolveCommandFlags(["--title=Hello World"], command);

  expect(resolved.diagnostics.length).toBe(0);
  expect(resolved.flags.title).toBe("Hello World");
});

test("resolveCommandFlags: tokens after -- stay positional", () => {
  const command = fixtureCommand({
    title: { kind: "string", description: "fixture string" },
  });
  const resolved = resolveCommandFlags(["--", "--title", "not-a-flag"], command);

  expect(resolved.diagnostics.length).toBe(2);
  expect(resolved.diagnostics[0]?.ruleId).toBe("KERNEL-ARG-01");
  expect(resolved.diagnostics[1]?.ruleId).toBe("KERNEL-ARG-01");
  expect(resolved.flags.title).toBe(undefined);
});

test("resolveCommandFlags: universal flags are merged into every schema-carrying command", () => {
  const command = fixtureCommand({});
  const resolved = resolveCommandFlags(["--json", "--site", "demo"], command);

  expect(resolved.diagnostics.length).toBe(0);
  expect(resolved.flags.json).toBe(true);
  expect(resolved.flags.site).toBe("demo");
});

test("resolveCommandFlags: missing flag with a default is filled in", () => {
  const command = fixtureCommand({
    kind: { kind: "string", default: "architecture", description: "fixture string with default" },
  });
  const resolved = resolveCommandFlags([], command);

  expect(resolved.diagnostics.length).toBe(0);
  expect(resolved.flags.kind).toBe("architecture");
});

test("parseKernelArgv: schema-less commands parse exactly as before (golden fixture)", () => {
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

test("executeKernelCommand: unknown option key fails with an explicit error naming argv (regression: commit 8b3e62ab)", async () => {
  try {
    await executeKernelCommand({
      workspaceRoot: process.cwd(),
      commandName: "noop",
      args: ["--phase=05-audit"],
    } as never);
    expect.fail("should have thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/unknown key/i);
    expect((error as Error).message).toMatch(/"args"/);
    expect((error as Error).message).toMatch(/did you mean "argv"/i);
  }
});
