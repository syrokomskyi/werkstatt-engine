import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractWorkersDevUrl,
  parseEnvFile,
  flagString,
  flagBoolean,
  runBuildCheck,
} from "./service-deploy-helpers.ts";

describe("extractWorkersDevUrl", () => {
  it("extracts workers.dev URL from wrangler output", () => {
    const stdout =
      "Uploaded lagebild-sync-dev (1.2 sec)\n  https://lagebild-sync-dev.syrokomskyi.workers.dev\n";
    expect(extractWorkersDevUrl(stdout)).toBe("https://lagebild-sync-dev.syrokomskyi.workers.dev");
  });

  it("returns undefined when no workers.dev URL found", () => {
    expect(extractWorkersDevUrl("no url here")).toBeUndefined();
  });

  it("extracts URL with trailing path", () => {
    const stdout = "Deployed to https://rate-fetcher-dev.syrokomskyi.workers.dev/health";
    expect(extractWorkersDevUrl(stdout)).toBe(
      "https://rate-fetcher-dev.syrokomskyi.workers.dev/health",
    );
  });
});

describe("parseEnvFile", () => {
  let tmpDir: string;

  it("parses key=value pairs", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "tmp-env-parse-"));
    const envPath = join(tmpDir, ".env");
    writeFileSync(envPath, "FOO=bar\nBAZ=qux\n# comment\n\nSKIP=\n");
    const env = await parseEnvFile(envPath);
    expect(env).toEqual({ FOO: "bar", BAZ: "qux" });
    rmSync(tmpDir, { recursive: true });
  });

  it("returns empty object for missing file", async () => {
    const env = await parseEnvFile("/nonexistent/.env");
    expect(env).toEqual({});
  });

  it("strips quotes from values", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "tmp-env-quotes-"));
    const envPath = join(tmpDir, ".env");
    writeFileSync(envPath, "KEY1=\"double quoted\"\nKEY2='single quoted'\n");
    const env = await parseEnvFile(envPath);
    expect(env).toEqual({ KEY1: "double quoted", KEY2: "single quoted" });
    rmSync(tmpDir, { recursive: true });
  });
});

describe("flagString", () => {
  it("returns string value", () => {
    expect(flagString({ flags: { service: "lagebild-sync" } } as never, "service")).toBe(
      "lagebild-sync",
    );
  });

  it("returns undefined for missing flag", () => {
    expect(flagString({ flags: {} } as never, "service")).toBeUndefined();
  });

  it("returns undefined for non-string flag", () => {
    expect(flagString({ flags: { service: true } } as never, "service")).toBeUndefined();
  });
});

describe("flagBoolean", () => {
  it("returns true for boolean true", () => {
    expect(flagBoolean({ flags: { dev: true } } as never, "dev")).toBe(true);
  });

  it("returns true for string 'true'", () => {
    expect(flagBoolean({ flags: { dev: "true" } } as never, "dev")).toBe(true);
  });

  it("returns false for missing flag", () => {
    expect(flagBoolean({ flags: {} } as never, "dev")).toBe(false);
  });
});

describe("runBuildCheck", () => {
  it("passes when build:check exits 0", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "tmp-buildcheck-pass-"));
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({
        name: "test-svc",
        scripts: { "build:check": 'node -e "process.exit(0)"' },
      }) + "\n",
    );
    const result = await runBuildCheck(tmpDir, { info: () => {} });
    expect(result.passed).toBe(true);
    expect(result.command).toBe("build:check");
    rmSync(tmpDir, { recursive: true });
  });

  it("fails when build:check exits non-zero", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "tmp-buildcheck-fail-"));
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({
        name: "test-svc",
        scripts: { "build:check": 'node -e "process.exit(1)"' },
      }) + "\n",
    );
    const result = await runBuildCheck(tmpDir, { info: () => {} });
    expect(result.passed).toBe(false);
    rmSync(tmpDir, { recursive: true });
  });
});
