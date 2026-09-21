import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  isClosedWorkpiece,
  writePatternToCheckPath,
  mutatingStepRunsOnClosedWorkpiece,
  mutatingCommandRunsOnClosedWorkpiece,
} from "../closed-workpiece.ts";
import { executeRegisteredCommand } from "../execute-command.ts";
import { createKernelLogger } from "../../logger.ts";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel";
import type {
  DiscoveredSiteWorkspace,
  KernelCommandDefinition,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";

// ADR-0085: closed-mission workpiece — mutating pipeline steps become no-ops
// unless every declared write resolves to a gitignored path inside the site.
// ADR-0087: the same guard is enforced in executeRegisteredCommand so direct
// executeKernelCommand calls cannot bypass it.

function makeCommand(
  name: string,
  mutatesState: boolean | undefined,
  writes?: string[],
): KernelCommandDefinition {
  return {
    name,
    description: "test",
    scope: "app",
    mutatesState,
    writes,
    execute: async () => ({ exitCode: 0, ok: true, summary: "ok" }),
  } as KernelCommandDefinition;
}

describe("isClosedWorkpiece", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(process.cwd(), "tmp-closed-wp-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns false when .closed sentinel is absent", () => {
    expect(isClosedWorkpiece(tmpDir)).toBe(false);
  });

  test("returns true when .closed sentinel exists", () => {
    writeFileSync(join(tmpDir, ".closed"), "closed\n");
    expect(isClosedWorkpiece(tmpDir)).toBe(true);
  });
});

describe("writePatternToCheckPath", () => {
  test("strips <app>/ prefix from concrete paths", () => {
    expect(writePatternToCheckPath("<app>/package.json", "site")).toBe("package.json");
  });

  test("cuts at the first glob character so parent-dir ignores apply", () => {
    expect(writePatternToCheckPath("<app>/dist/client/**", "site")).toBe("dist/client");
    expect(writePatternToCheckPath("<app>/public/**/*.md", "site")).toBe("public");
  });

  test("replaces {app} and other placeholders with literals", () => {
    expect(writePatternToCheckPath("<app>/public/{app}-indexnow.txt", "warpgogol")).toBe(
      "public/warpgogol-indexnow.txt",
    );
    expect(writePatternToCheckPath("<app>/src/pages/api/{route}.ts", "site")).toBe(
      "src/pages/api/x.ts",
    );
  });

  test("returns null for non-<app> patterns (outside the site directory)", () => {
    expect(writePatternToCheckPath("systems/{system}/bordbuch.json", "site")).toBeNull();
    expect(writePatternToCheckPath("uni.registry.yaml", "site")).toBeNull();
    expect(writePatternToCheckPath("<cache>/public/manifest.json", "site")).toBeNull();
  });
});

describe("mutatingStepRunsOnClosedWorkpiece", () => {
  const ignored = new Set(["dist/.well-known/cosmic-passport.json", "dist/client", ".cache/pdf"]);

  test("runs when every declared write is gitignored (dist-only mutator)", () => {
    const cmd = makeCommand("passport.emit", true, ["<app>/dist/.well-known/cosmic-passport.json"]);
    expect(
      mutatingStepRunsOnClosedWorkpiece(cmd, "site", ignored),
      "dist-only mutators must run — release.prepare rebuild path needs them",
    ).toBe(true);
  });

  test("skips when any declared write is tracked", () => {
    const cmd = makeCommand("config.regenerate", true, [
      "<app>/package.json",
      "<app>/astro.config.mjs",
    ]);
    expect(mutatingStepRunsOnClosedWorkpiece(cmd, "site", ignored)).toBe(false);
  });

  test("skips when writes mix gitignored and tracked paths", () => {
    const cmd = makeCommand("image.variants.generate", true, [
      "<app>/src/image-variants.generated.yaml",
      "<app>/public/_img/**",
    ]);
    expect(mutatingStepRunsOnClosedWorkpiece(cmd, "site", ignored)).toBe(false);
  });

  test("skips when writes are undeclared (empty writes cannot prove confinement)", () => {
    const cmd = makeCommand("bordbuch.commit", true, []);
    expect(mutatingStepRunsOnClosedWorkpiece(cmd, "site", ignored)).toBe(false);
  });

  test("skips when writes resolve outside the site directory", () => {
    const cmd = makeCommand("uni.registry.build", true, ["uni.registry.yaml"]);
    expect(mutatingStepRunsOnClosedWorkpiece(cmd, "site", ignored)).toBe(false);
  });

  test("runs everything when git tracking is absent (null ignoredPaths)", () => {
    const cmd = makeCommand("config.regenerate", true, ["<app>/package.json"]);
    expect(
      mutatingStepRunsOnClosedWorkpiece(cmd, "site", null),
      "without a git repo no write can produce committable churn",
    ).toBe(true);
  });
});

describe("collectGitignoredPaths integration (real git repo)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(process.cwd(), "tmp-closed-git-"));
    execSync("git init -q", { cwd: tmpDir });
    writeFileSync(join(tmpDir, ".gitignore"), "dist/\n.cache/\npublic/_img/\n");
    mkdirSync(join(tmpDir, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("gitignored write prefixes are detected via git check-ignore", () => {
    // Reproduce the pipeline-run batch: dist-only mutator runs, tracked writer skips.
    const distOnly = makeCommand("passport.emit", true, [
      "<app>/dist/.well-known/cosmic-passport.json",
    ]);
    const tracked = makeCommand("config.regenerate", true, ["<app>/package.json"]);

    const candidates = [distOnly, tracked].flatMap((c) =>
      (c.writes ?? [])
        .map((w) => writePatternToCheckPath(w, "site"))
        .filter((p): p is string => p !== null),
    );

    const output = execSync("git check-ignore --stdin", {
      cwd: tmpDir,
      input: `${candidates.join("\n")}\n`,
      encoding: "utf-8",
    });
    const ignored = new Set(
      output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );

    expect(mutatingStepRunsOnClosedWorkpiece(distOnly, "site", ignored)).toBe(true);
    expect(mutatingStepRunsOnClosedWorkpiece(tracked, "site", ignored)).toBe(false);
  });

  test("mutatingCommandRunsOnClosedWorkpiece resolves gitignore internally", () => {
    const site = { name: "site", directory: tmpDir } as DiscoveredSiteWorkspace;
    const distOnly = makeCommand("passport.emit", true, [
      "<app>/dist/.well-known/cosmic-passport.json",
    ]);
    const tracked = makeCommand("config.regenerate", true, ["<app>/package.json"]);
    expect(mutatingCommandRunsOnClosedWorkpiece(distOnly, site)).toBe(true);
    expect(mutatingCommandRunsOnClosedWorkpiece(tracked, site)).toBe(false);
  });
});

describe("executeRegisteredCommand closed-workpiece guard (ADR-0087)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(process.cwd(), "tmp-closed-exec-"));
    execSync("git init -q", { cwd: tmpDir });
    writeFileSync(join(tmpDir, ".gitignore"), "dist/\n");
    writeFileSync(join(tmpDir, ".closed"), "closed\n");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeContext(siteDir: string): KernelRuntimeContext {
    const { io, intents } = createDefaultIO();
    return {
      logger: createKernelLogger(),
      workspaceRoot: siteDir,
      site: { name: "site", directory: siteDir } as DiscoveredSiteWorkspace,
      io,
      fileIntents: intents,
    } as unknown as KernelRuntimeContext;
  }

  test("mutating command with tracked writes is skipped without executing", async () => {
    let executed = false;
    const cmd = makeCommand("config.regenerate", true, ["<app>/package.json"]);
    cmd.execute = async () => {
      executed = true;
      return { exitCode: 0, ok: true, summary: "ran" };
    };
    const report = await executeRegisteredCommand(cmd, makeContext(tmpDir), []);
    expect(executed, "mutating command must not run on a closed workpiece").toBe(false);
    expect(report.summary).toBe("Skipped: closed-mission");
    expect(report.ok).toBe(true);
  });

  test("read-only command is not affected by the closed-workpiece guard", async () => {
    // mutatesState: false bypasses the guard entirely — the command would
    // proceed to flag parsing/execution; we only assert the guard did not
    // produce a closed-mission skip report.
    const cmd = makeCommand("content.validate", false, []);
    cmd.execute = async () => ({ exitCode: 0, ok: true, summary: "validated" });
    const report = await executeRegisteredCommand(cmd, makeContext(tmpDir), []);
    expect(report.summary).not.toBe("Skipped: closed-mission");
  });

  test("mutating command runs when the workpiece is not closed", async () => {
    rmSync(join(tmpDir, ".closed"));
    let executed = false;
    const cmd = makeCommand("config.regenerate", true, ["<app>/package.json"]);
    cmd.execute = async () => {
      executed = true;
      return { exitCode: 0, ok: true, summary: "ran" };
    };
    const report = await executeRegisteredCommand(cmd, makeContext(tmpDir), []);
    expect(executed).toBe(true);
    expect(report.summary).toBe("ran");
  });
});
