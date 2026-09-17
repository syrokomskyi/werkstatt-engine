import { test, expect, describe } from "vitest";
import { parseKernelArgv, resolveCommandFlags, KERNEL_UNIVERSAL_FLAGS } from "../argv.ts";
import type { KernelCommandDefinition } from "@warpgogol/werkstatt-shared/kernel";

const mockDefinition: KernelCommandDefinition = {
  name: "test.cmd",
  description: "test command",
  scope: "workspace",
  flags: {
    id: { kind: "string", required: true, description: "The ID" },
    tag: { kind: "string[]", description: "Tags" },
    verbose: { kind: "boolean", description: "Verbose" },
  },
  execute: async () => ({ exitCode: 0, ok: true, summary: "ok" }),
};

describe("parseKernelArgv (legacy heuristic parser)", () => {
  test("parses boolean flag without consuming next token", () => {
    const { flags, diagnostics } = parseKernelArgv(["--dry-run", "alpha"]);
    expect(flags["dry-run"]).toBe(true);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.ruleId).toBe("KERNEL-ARG-01");
  });

  test("parses string flag by consuming next token", () => {
    const { flags, diagnostics } = parseKernelArgv(["--site", "my-site"]);
    expect(flags["site"]).toBe("my-site");
    expect(diagnostics).toHaveLength(0);
  });

  test("parses inline value with =", () => {
    const { flags } = parseKernelArgv(["--site=my-site"]);
    expect(flags["site"]).toBe("my-site");
  });

  test("collects repeated string flags into array", () => {
    const { flags } = parseKernelArgv(["--tag", "a", "--tag", "b"]);
    expect(flags["tag"]).toEqual(["a", "b"]);
  });

  test("emits diagnostic for positional argument", () => {
    const { diagnostics } = parseKernelArgv(["positional"]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.ruleId).toBe("KERNEL-ARG-01");
  });

  test("passthrough after -- emits diagnostics for all subsequent tokens", () => {
    const { diagnostics } = parseKernelArgv(["--", "foo", "bar"]);
    expect(diagnostics).toHaveLength(2);
  });

  test("boolean flag set includes dry-run, force, json, quiet, verbose", () => {
    const { flags } = parseKernelArgv(["--dry-run", "--force", "--json", "--quiet", "--verbose"]);
    expect(flags["dry-run"]).toBe(true);
    expect(flags["force"]).toBe(true);
    expect(flags["json"]).toBe(true);
    expect(flags["quiet"]).toBe(true);
    expect(flags["verbose"]).toBe(true);
  });
});

describe("resolveCommandFlags (schema-driven parser)", () => {
  test("resolves boolean flag from schema", () => {
    const { flags, diagnostics } = resolveCommandFlags(["--verbose"], mockDefinition);
    expect(flags["verbose"]).toBe(true);
    // KERNEL-FLAG-03 for missing required --id is expected
    expect(diagnostics.filter((d) => d.ruleId !== "KERNEL-FLAG-03")).toHaveLength(0);
  });

  test("resolves string flag by consuming next token", () => {
    const { flags, diagnostics } = resolveCommandFlags(["--id", "abc"], mockDefinition);
    expect(flags["id"]).toBe("abc");
    expect(diagnostics).toHaveLength(0);
  });

  test("resolves inline value with =", () => {
    const { flags } = resolveCommandFlags(["--id=abc"], mockDefinition);
    expect(flags["id"]).toBe("abc");
  });

  test("emits KERNEL-FLAG-01 for unknown flag", () => {
    const { diagnostics } = resolveCommandFlags(["--bogus"], mockDefinition);
    const flag01 = diagnostics.filter((d) => d.ruleId === "KERNEL-FLAG-01");
    expect(flag01).toHaveLength(1);
  });

  test("emits KERNEL-FLAG-02 when string flag has no value", () => {
    const { diagnostics } = resolveCommandFlags(["--id"], mockDefinition);
    const flag02 = diagnostics.filter((d) => d.ruleId === "KERNEL-FLAG-02");
    expect(flag02).toHaveLength(1);
  });

  test("emits KERNEL-FLAG-03 for missing required flag", () => {
    const { diagnostics } = resolveCommandFlags(["--verbose"], mockDefinition);
    const flag03 = diagnostics.find((d) => d.ruleId === "KERNEL-FLAG-03");
    expect(flag03).toBeDefined();
    expect(flag03!.message).toContain("--id");
  });

  test("applies default value for unspecified flag with default", () => {
    const def: KernelCommandDefinition = {
      name: "test.cmd",
      description: "test",
      scope: "workspace",
      flags: {
        level: { kind: "string", default: "info", description: "Level" },
      },
      execute: async () => ({ exitCode: 0, ok: true, summary: "ok" }),
    };
    const { flags } = resolveCommandFlags([], def);
    expect(flags["level"]).toBe("info");
  });

  test("accepts universal flags (site, json, dry-run, etc.)", () => {
    const { flags, diagnostics } = resolveCommandFlags(
      ["--site", "foo", "--json", "--dry-run"],
      mockDefinition,
    );
    expect(diagnostics.filter((d) => d.ruleId === "KERNEL-FLAG-01")).toHaveLength(0);
    expect(flags["site"]).toBe("foo");
    expect(flags["json"]).toBe(true);
    expect(flags["dry-run"]).toBe(true);
  });

  test("collects string[] flag from repeated tokens", () => {
    const { flags } = resolveCommandFlags(["--tag", "a", "--tag", "b"], mockDefinition);
    expect(flags["tag"]).toEqual(["a", "b"]);
  });

  test("boolean flag with inline false value resolves to false", () => {
    const { flags } = resolveCommandFlags(["--verbose=false"], mockDefinition);
    expect(flags["verbose"]).toBe(false);
  });
});

describe("KERNEL_UNIVERSAL_FLAGS", () => {
  test("includes site, all, json, quiet, verbose, root, dry-run, force, help", () => {
    const keys = Object.keys(KERNEL_UNIVERSAL_FLAGS);
    expect(keys).toContain("site");
    expect(keys).toContain("all");
    expect(keys).toContain("json");
    expect(keys).toContain("quiet");
    expect(keys).toContain("verbose");
    expect(keys).toContain("root");
    expect(keys).toContain("dry-run");
    expect(keys).toContain("force");
    expect(keys).toContain("help");
  });

  test("site is string kind", () => {
    expect(KERNEL_UNIVERSAL_FLAGS["site"]!.kind).toBe("string");
  });

  test("dry-run is boolean kind", () => {
    expect(KERNEL_UNIVERSAL_FLAGS["dry-run"]!.kind).toBe("boolean");
  });
});
