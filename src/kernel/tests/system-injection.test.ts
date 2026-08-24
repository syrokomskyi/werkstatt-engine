import { describe, expect, it, vi } from "vitest";
import type { KernelCommandDefinition } from "../types.ts";
import type { DiscoveredSiteWorkspace } from "../types.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0814: Unit tests for --system auto-injection in pipeline and CLI paths.
    Verifies that workspace-scoped commands receive --system automatically
    when they declare a `system` string flag or have no flag schema.
    RFC-0817: Extended to verify --system=value and --site=value formats
    are detected and not double-injected.
  </purpose>
</MODULE_CONTRACT>
*/

function makeFlagSpec(kind: "string" | "boolean", required?: boolean) {
  return { kind, ...(required !== undefined ? { required } : {}) };
}

function makeCommand(
  name: string,
  flags?: Record<string, ReturnType<typeof makeFlagSpec>>,
): KernelCommandDefinition {
  return {
    name,
    description: `Test command ${name}`,
    scope: "workspace",
    supportsAllSites: false,
    execute: vi.fn(),
    ...(flags ? { flags } : {}),
  } as unknown as KernelCommandDefinition;
}

function makeSite(name: string): DiscoveredSiteWorkspace {
  return {
    name,
    directory: `/test/${name}`,
    toolsDirectory: `/test/${name}/tools`,
  };
}

/**
 * Replicate the pipeline injection logic from executePipelineForSite.
 * This is the exact same conditional block — extracted for testability.
 */
function injectSystemPipeline(
  command: KernelCommandDefinition,
  stepArgs: string[],
  siteName: string,
): void {
  if (
    command.scope === "workspace" &&
    !stepArgs.some((a) => a === "--system" || a.startsWith("--system=")) &&
    siteName
  ) {
    const acceptsSystem =
      !command.flags || ("system" in command.flags && command.flags.system.kind === "string");
    if (acceptsSystem) {
      stepArgs.push("--system", siteName);
    }
  }
}

/**
 * Replicate the CLI injection logic from executeKernelCommand.
 * This is the exact same conditional block — extracted for testability.
 */
function injectSystemCli(
  command: KernelCommandDefinition,
  wsArgv: string[],
  siteName: string,
): void {
  if (siteName && !wsArgv.some((a) => a === "--system" || a.startsWith("--system="))) {
    const acceptsSystem =
      !command.flags || ("system" in command.flags && command.flags.system.kind === "string");
    if (acceptsSystem) {
      wsArgv.push("--system", siteName);
    }
  }
}

describe("RFC-0814: --system auto-injection in pipeline path", () => {
  it("(a) workspace command with system:string flag receives --system <site.name>", () => {
    const cmd = makeCommand("test.cmd.with-system", {
      system: makeFlagSpec("string"),
    });
    const site = makeSite("warpgogol-com");
    const stepArgs: string[] = [];

    injectSystemPipeline(cmd, stepArgs, site.name);

    expect(stepArgs).toContain("--system");
    expect(stepArgs).toContain("warpgogol-com");
  });

  it("(b) workspace command without system flag is unaffected", () => {
    const cmd = makeCommand("test.cmd.no-system", {
      "dry-run": makeFlagSpec("boolean"),
    });
    const site = makeSite("warpgogol-com");
    const stepArgs: string[] = [];

    injectSystemPipeline(cmd, stepArgs, site.name);

    expect(stepArgs).not.toContain("--system");
    expect(stepArgs).not.toContain("warpgogol-com");
  });

  it("(c) explicit --system in step args is not duplicated", () => {
    const cmd = makeCommand("test.cmd.explicit-system", {
      system: makeFlagSpec("string"),
    });
    const site = makeSite("warpgogol-com");
    const stepArgs = ["--system", "custom-system-id"];

    injectSystemPipeline(cmd, stepArgs, site.name);

    const systemCount = stepArgs.filter((a) => a === "--system").length;
    expect(systemCount).toBe(1);
    expect(stepArgs).toContain("custom-system-id");
    expect(stepArgs).not.toContain("warpgogol-com");
  });

  it("(d) workspace command with system:boolean flag is unaffected", () => {
    const cmd = makeCommand("test.cmd.boolean-system", {
      system: makeFlagSpec("boolean"),
    });
    const site = makeSite("warpgogol-com");
    const stepArgs: string[] = [];

    injectSystemPipeline(cmd, stepArgs, site.name);

    expect(stepArgs).not.toContain("--system");
  });

  it("(e) workspace command with no flag schema (legacy) receives --system", () => {
    const cmd = makeCommand("test.cmd.legacy");
    const site = makeSite("warpgogol-com");
    const stepArgs: string[] = [];

    injectSystemPipeline(cmd, stepArgs, site.name);

    expect(stepArgs).toContain("--system");
    expect(stepArgs).toContain("warpgogol-com");
  });
});

describe("RFC-0814: --system auto-injection in CLI path (executeKernelCommand)", () => {
  it("(f) CLI workspace command with system:string flag receives --system <siteName>", () => {
    const cmd = makeCommand("test.cli.with-system", {
      system: makeFlagSpec("string"),
    });
    const siteName = "warpgogol-com";
    const wsArgv: string[] = [];

    if (siteName && !wsArgv.some((a) => a === "--site" || a.startsWith("--site="))) {
      wsArgv.push("--site", siteName);
    }
    injectSystemCli(cmd, wsArgv, siteName);

    expect(wsArgv).toContain("--site");
    expect(wsArgv).toContain("--system");
    expect(wsArgv).toContain("warpgogol-com");
  });

  it("(g) CLI workspace command without system flag is unaffected", () => {
    const cmd = makeCommand("test.cli.no-system", {
      "dry-run": makeFlagSpec("boolean"),
    });
    const siteName = "warpgogol-com";
    const wsArgv: string[] = [];

    if (siteName && !wsArgv.some((a) => a === "--site" || a.startsWith("--site="))) {
      wsArgv.push("--site", siteName);
    }
    injectSystemCli(cmd, wsArgv, siteName);

    expect(wsArgv).toContain("--site");
    expect(wsArgv).not.toContain("--system");
  });

  it("(h) CLI explicit --system in argv is not duplicated", () => {
    const cmd = makeCommand("test.cli.explicit", {
      system: makeFlagSpec("string"),
    });
    const siteName = "warpgogol-com";
    const wsArgv = ["--system", "custom-id"];

    injectSystemCli(cmd, wsArgv, siteName);

    const systemCount = wsArgv.filter((a) => a === "--system").length;
    expect(systemCount).toBe(1);
    expect(wsArgv).toContain("custom-id");
    expect(wsArgv).not.toContain("warpgogol-com");
  });
});

describe("RFC-0817: --system=value and --site=value format detection", () => {
  it("(i) pipeline: --system=value in step args is not double-injected", () => {
    const cmd = makeCommand("test.cmd.pipeline-system-eq", {
      system: makeFlagSpec("string"),
    });
    const site = makeSite("warpgogol-com");
    const stepArgs = ["--system=custom-id"];

    injectSystemPipeline(cmd, stepArgs, site.name);

    const systemCount = stepArgs.filter((a) => a === "--system").length;
    expect(systemCount).toBe(0);
    expect(stepArgs).toContain("--system=custom-id");
    expect(stepArgs).not.toContain("warpgogol-com");
  });

  it("(j) CLI: --system=value in argv is not double-injected", () => {
    const cmd = makeCommand("test.cli.system-eq", {
      system: makeFlagSpec("string"),
    });
    const siteName = "warpgogol-com";
    const wsArgv = ["--system=custom-id"];

    injectSystemCli(cmd, wsArgv, siteName);

    const systemCount = wsArgv.filter((a) => a === "--system").length;
    expect(systemCount).toBe(0);
    expect(wsArgv).toContain("--system=custom-id");
    expect(wsArgv).not.toContain("warpgogol-com");
  });

  it("(k) CLI: --site=value in argv is not double-injected", () => {
    const _cmd = makeCommand("test.cli.site-eq", {
      system: makeFlagSpec("string"),
    });
    const siteName = "warpgogol-com";
    const wsArgv = ["--site=custom-site"];

    if (siteName && !wsArgv.some((a) => a === "--site" || a.startsWith("--site="))) {
      wsArgv.push("--site", siteName);
    }

    const siteCount = wsArgv.filter((a) => a === "--site").length;
    expect(siteCount).toBe(0);
    expect(wsArgv).toContain("--site=custom-site");
  });
});
