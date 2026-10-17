/*
<MODULE_CONTRACT>
<purpose>
Unit tests for validation report evidence covering validation-report evidence (RFC-1296).
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the validation suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

// @vitest-environment node
/*
 * RFC-1296: validation-report.json must carry honest evidence — per-validator
 * diagnostic summaries, real dist facts, and reuse paths that copy previous
 * validator evidence (or refuse the pass).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { computeDistFacts } from "./dist-facts.ts";
import { contractFullFromPrevious, validatorsFromPipelineReports } from "./validation-report.ts";
import type { PreviousValidationReport } from "./mission-materialization-commands.ts";
import type { KernelPipelineReport } from "@warpgogol/werkstatt-engine/kernel";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "vr-evidence-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function step(
  commandName: string,
  data: unknown,
  ok = true,
  exitCode = 0,
): KernelPipelineReport["steps"][number] {
  return { commandName, ok, exitCode, data } as KernelPipelineReport["steps"][number];
}

function report(steps: KernelPipelineReport["steps"]): KernelPipelineReport {
  return { steps } as KernelPipelineReport;
}

describe("validation-report evidence (RFC-1296)", () => {
  it("AC-2: validator entry carries per-rule warning counts from step data", () => {
    const validators = validatorsFromPipelineReports(
      report([
        step("typography.validate", {
          diagnostics: [
            { ruleId: "TERMS-DRIFT-01", severity: "warning" },
            { ruleId: "TERMS-DRIFT-01", severity: "warning" },
            { ruleId: "TYPO-01", severity: "error" },
          ],
        }),
      ]),
      report([
        step("text.corpus.validate", { findings: [{ ruleId: "TERM-04", severity: "warning" }] }),
      ]),
    );
    expect(validators).toHaveLength(2);
    const typo = validators[0]!;
    expect(typo.name).toBe("typography.validate");
    expect(typo.pipeline).toBe("build.check");
    expect(typo.warnings).toBe(2);
    expect(typo.errors).toBe(1);
    expect(typo.rules?.["TERMS-DRIFT-01"]).toEqual({ error: 0, warning: 2 });
    expect(validators[1]!.pipeline).toBe("build.post");
    expect(validators[1]!.rules?.["TERM-04"]).toEqual({ error: 0, warning: 1 });
  });

  it("AC-3: reuse path copies previous validators and stamps reusedFrom", () => {
    const previous: PreviousValidationReport = {
      schemaVersion: "1.0.0",
      missionId: "m000100",
      contractFull: {
        passed: true,
        validators: [
          {
            name: "list.punctuation.validate",
            status: "pass",
            exitCode: 0,
            warnings: 3,
            rules: { "LP-03": { error: 0, warning: 3 } },
          },
        ],
      },
      build: { succeeded: true, routeCount: 120, sitemapHash: "sha256:x", failedSteps: [] },
      distributionReused: false,
      buildInputHash: null,
      fullBuildRan: true,
      validatedAt: "2026-10-14T10:00:00Z",
    };
    const cf = contractFullFromPrevious(previous);
    expect(cf.passed).toBe(true);
    expect(cf.reusedFrom).toBe("2026-10-14T10:00:00Z");
    expect(cf.validators[0]!.rules?.["LP-03"]).toEqual({ error: 0, warning: 3 });
  });

  it("AC-3b: reuse without previous report is not a pass", () => {
    const cf = contractFullFromPrevious(null);
    expect(cf.passed).toBe(false);
    expect(cf.reason).toBe("no-validator-evidence");
    expect(cf.validators).toEqual([]);
  });

  it("AC-3c: reuse with an empty validator list is not a pass", () => {
    const cf = contractFullFromPrevious({
      contractFull: { passed: true, validators: [] },
      validatedAt: "2026-10-14T10:00:00Z",
    } as unknown as PreviousValidationReport);
    expect(cf.passed).toBe(false);
    expect(cf.reason).toBe("no-validator-evidence");
  });

  it("AC-3d: reused failing validator evidence keeps passed:false", () => {
    const cf = contractFullFromPrevious({
      contractFull: {
        passed: false,
        validators: [{ name: "x", status: "fail", exitCode: 1 }],
      },
      validatedAt: "2026-10-14T10:00:00Z",
    } as unknown as PreviousValidationReport);
    expect(cf.passed).toBe(false);
    expect(cf.validators).toHaveLength(1);
  });

  it("AC-4: computeDistFacts counts non-redirect pages and hashes the real sitemap", async () => {
    const dist = join(tmp, "dist");
    mkdirSync(join(dist, "client", "a"), { recursive: true });
    mkdirSync(join(dist, "client", "b"), { recursive: true });
    mkdirSync(join(dist, "client", "stub"), { recursive: true });
    writeFileSync(join(dist, "client", "a", "index.html"), "<html><body>A</body></html>");
    writeFileSync(join(dist, "client", "b", "index.html"), "<html><body>B</body></html>");
    writeFileSync(
      join(dist, "client", "stub", "index.html"),
      '<html><head><meta http-equiv="refresh" content="0;url=/de/"></head></html>',
    );
    writeFileSync(join(dist, "client", "sitemap.xml"), "<urlset/>");

    const facts = await computeDistFacts(dist);
    expect(facts.routeCount).toBe(2);
    expect(facts.sitemapHash).toMatch(/^sha256:/);
    expect(facts.sitemapHash).not.toBe("sha256:no-sitemap");
  });

  it("computeDistFacts falls back to dist root and reports no-sitemap", async () => {
    const dist = join(tmp, "dist2");
    mkdirSync(join(dist, "x"), { recursive: true });
    writeFileSync(join(dist, "x", "index.html"), "<html><body>X</body></html>");
    const facts = await computeDistFacts(dist);
    expect(facts.routeCount).toBe(1);
    expect(facts.sitemapHash).toBe("sha256:no-sitemap");
  });
});
