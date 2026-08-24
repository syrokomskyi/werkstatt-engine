/*
<MODULE_CONTRACT>
<purpose>RFC-0578: tests for buildFailureDiagnostics pattern matching in mission.validate.</purpose>
<keywords>RFC-0578, BUILD-01, buildFailureDiagnostics, pattern matching, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0578: add unit tests for buildFailureDiagnostics pattern matching.</item>
</CHANGE_SUMMARY>
*/
import { describe, it, expect } from "vitest";
import { buildFailureDiagnostics } from "../mission/mission-materialization-commands.ts";

describe("buildFailureDiagnostics", () => {
  it("matches enoent-system-manifest pattern", () => {
    const error = "Error: ENOENT: no such file or directory, open '/path/to/content/system.md'";
    const diags = buildFailureDiagnostics(error);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("BUILD-01");
    expect(diags[0].severity).toBe("error");
    expect(diags[0].data?.patternId).toBe("enoent-system-manifest");
    expect(diags[0].fixHint).toContain("import.meta.env.DEV");
    expect(diags[0].message).toContain("enoent-system-manifest");
  });

  it("matches module-not-found pattern", () => {
    const error = "Error: Cannot find module '@warpgogol/werkstatt-shared/share' from '/path/to/file.ts'";
    const diags = buildFailureDiagnostics(error);
    expect(diags[0].data?.patternId).toBe("module-not-found");
    expect(diags[0].fixHint).toContain("pnpm install");
  });

  it("matches content-schema-error pattern", () => {
    const error = "ZodError: Expected string, received number at frontmatter.title";
    const diags = buildFailureDiagnostics(error);
    expect(diags[0].data?.patternId).toBe("content-schema-error");
    expect(diags[0].fixHint).toContain("frontmatter");
  });

  it("matches typescript-error pattern", () => {
    const error =
      "src/components/Header.astro:10:5 - error TS2322: Type 'string' is not assignable to type 'number'";
    const diags = buildFailureDiagnostics(error);
    expect(diags[0].data?.patternId).toBe("typescript-error");
    expect(diags[0].fixHint).toContain("TypeScript");
  });

  it("falls back to unknown pattern for unrecognized errors", () => {
    const error = "Some completely unknown error format that doesn't match any pattern";
    const diags = buildFailureDiagnostics(error);
    expect(diags[0].data?.patternId).toBe("unknown");
    expect(diags[0].fixHint).toBe("Read the full build output above for the error details.");
    expect(diags[0].message).toContain(error.slice(0, 200));
  });

  it("includes buildErrorLength in data", () => {
    const error = "Cannot find module 'foo'";
    const diags = buildFailureDiagnostics(error);
    expect(diags[0].data?.buildErrorLength).toBe(error.length);
  });

  it("preserves raw build.error string separately from diagnostics", () => {
    const error = "ENOENT: no such file or directory, open 'system.md'";
    const diags = buildFailureDiagnostics(error);
    expect(diags[0].message).toContain("ENOENT");
    expect(diags[0].data?.patternId).toBe("enoent-system-manifest");
  });
});
