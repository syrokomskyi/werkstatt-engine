/*
<MODULE_CONTRACT>
<purpose>RFC-1281 AC-3…AC-6: rule-level tests for validateIntakeBundle — one
describe per rule INTAKE-01…11, each building the valid bundle via
buildIntakeBundle and breaking exactly one rule. Covers the committed
fixtures/valid-minimal pass case, the single-byte verbatim mutation
(INTAKE-05), the invalid-PBP path shape (/pbp/<index>, INTAKE-03), and the
INTAKE-11 warning-only contract (status stays pass).</purpose>
<non-goals>
  <item>Do not test the kernel flag plumbing — handler-level usage checks are covered by the module declaration and manual probes.</item>
</non-goals>
<CHANGE_SUMMARY>
  <item>RFC-1281: created — one describe per INTAKE rule + committed-fixture pass test.</item>
  <item>RFC-1281: intake contract and onboarding.intake.validate</item>
  <item>RFC-1281: resolve valid-minimal fixture path relative to test file</item>
</CHANGE_SUMMARY>
*/

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { describe, expect, it } from "vitest";

import {
  validateIntakeBundle,
  resolveIntakeExportSha256,
  type IntakeRuleId,
} from "./intake-validate.ts";
import { buildIntakeBundle, type BuildIntakeBundleOptions } from "./test-bundle.ts";

const { io } = createDefaultIO();

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "intake-"));
}

async function buildAndValidate(options: BuildIntakeBundleOptions = {}, dir: string = tmp()) {
  await buildIntakeBundle(dir, io, options);
  const exportInfo = await resolveIntakeExportSha256(io);
  if (!exportInfo) throw new Error("schema export missing — run onboarding.intake.schema.export");
  return validateIntakeBundle(dir, io, { exportSha256: exportInfo.sha256 });
}

const rules = (
  result: Awaited<ReturnType<typeof buildAndValidate>>,
  severity: "error" | "warning" = "error",
): IntakeRuleId[] => result.diagnostics.filter((d) => d.severity === severity).map((d) => d.rule);

describe("committed fixture (AC-3)", () => {
  it("fixtures/valid-minimal passes with zero errors", async () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/valid-minimal");
    const exportInfo = await resolveIntakeExportSha256(io);
    const result = await validateIntakeBundle(dir, io, {
      exportSha256: exportInfo!.sha256,
    });
    expect(result.status).toBe("pass");
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.intakeId).toMatch(/^int_/);
    expect(result.systemId).toBe("dp7");
    expect(result.contractSnapshot.actual).toBe(result.contractSnapshot.expected);
  });
});

describe("INTAKE-01 — manifest/hash integrity", () => {
  it("tampered manifest hash fails", async () => {
    const result = await buildAndValidate({
      manifestTransform: (m) => m.replace(/[0-9a-f]/, "0"),
    });
    expect(result.status).toBe("fail");
    expect(rules(result)).toContain("INTAKE-01");
  });

  it("unlisted file fails", async () => {
    const dir = tmp();
    await buildIntakeBundle(dir, io);
    await io.writeFile(join(dir, "stray.bin"), "x");
    const exportInfo = await resolveIntakeExportSha256(io);
    const result = await validateIntakeBundle(dir, io, { exportSha256: exportInfo!.sha256 });
    expect(result.status).toBe("fail");
    expect(rules(result)).toContain("INTAKE-01");
  });
});

describe("INTAKE-02 — envelope schema", () => {
  it("invalid envelope field fails", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        seed.envelope.systemId = "Bad System!";
      },
    });
    expect(result.status).toBe("fail");
    expect(rules(result)).toContain("INTAKE-02");
  });

  it("unknown major fails closed", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        seed.envelope.schema = "werkstatt:intake/v2";
      },
    });
    expect(result.status).toBe("fail");
    const intake02 = result.diagnostics.filter((d) => d.rule === "INTAKE-02");
    expect(intake02.length).toBeGreaterThanOrEqual(1);
    expect(intake02.some((d) => d.message.includes("unsupported intake schema"))).toBe(true);
  });
});

describe("INTAKE-03 — canonical PBP validation", () => {
  it("invalid entity reports INTAKE-03 with /pbp/<index> path (AC-6)", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        const pbp = seed.envelope.pbp as Record<string, unknown>[];
        pbp[0].name = ""; // business.name must be non-empty
      },
    });
    expect(result.status).toBe("fail");
    const d03 = result.diagnostics.filter((d) => d.rule === "INTAKE-03");
    expect(d03.length).toBeGreaterThanOrEqual(1);
    expect(d03.some((d) => /^\/pbp\/0(\/|$)/.test(d.path ?? ""))).toBe(true);
  });
});

describe("INTAKE-04 — referential integrity", () => {
  it("annotation key without a pbp entity fails", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        (seed.envelope.annotations as Record<string, unknown>)["claim/ghost"] = {
          internal: true,
        };
      },
    });
    expect(result.status).toBe("fail");
    expect(rules(result)).toContain("INTAKE-04");
  });

  it("gap.blocks pointing at a missing entity fails", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        ((seed.envelope.gaps as Record<string, unknown>[])[0].blocks as string[]).push(
          "claim/ghost",
        );
      },
    });
    expect(result.status).toBe("fail");
    expect(rules(result)).toContain("INTAKE-04");
  });
});

describe("INTAKE-05 — byte-exact verbatim quotes", () => {
  it("single-byte quote mutation fails (AC-5)", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        const annotations = seed.envelope.annotations as Record<
          string,
          { verbatim?: { text: string }[] }
        >;
        annotations["claim/european-quality"].verbatim![0].text += "x";
      },
    });
    expect(result.status).toBe("fail");
    expect(rules(result)).toContain("INTAKE-05");
  });
});

describe("INTAKE-06 — draft entities name a gap or are internal", () => {
  it("draft claim without gapRef/internal fails", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        (seed.envelope.annotations as Record<string, unknown>)["claim/installation-warranty"] = {};
      },
    });
    expect(result.status).toBe("fail");
    expect(rules(result)).toContain("INTAKE-06");
  });
});

describe("INTAKE-07 — locales", () => {
  it("two primary locales fails", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        const classification = seed.envelope.classification as {
          locales: Record<string, unknown>[];
        };
        classification.locales.push({
          tag: "de",
          role: "primary",
          sourceLanguageBy: "studio",
          reviewer: "studio",
        });
      },
    });
    expect(result.status).toBe("fail");
    expect(rules(result)).toContain("INTAKE-07");
  });
});

describe("INTAKE-08 — biome axes", () => {
  it("invalid axis value fails", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        const visual = seed.envelope.visual as { axes: Record<string, unknown> };
        visual.axes.warmth = "tropical";
      },
    });
    expect(result.status).toBe("fail");
    expect(rules(result)).toContain("INTAKE-08");
  });
});

describe("INTAKE-09 — asset files", () => {
  it("declared sha256 mismatch fails", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        (seed.envelope.assets as Record<string, unknown>[])[0].sha256 = `sha256:${"0".repeat(64)}`;
      },
    });
    expect(result.status).toBe("fail");
    expect(rules(result)).toContain("INTAKE-09");
  });
});

describe("INTAKE-10 — provenance completeness", () => {
  it("contract snapshot mismatch fails", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        (seed.envelope.provenance as Record<string, unknown>).contractSnapshot =
          `sha256:${"f".repeat(64)}`;
      },
    });
    expect(result.status).toBe("fail");
    expect(rules(result)).toContain("INTAKE-10");
  });
});

describe("INTAKE-11 — cost report warnings never block", () => {
  it("over-budget total warns while status stays pass", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        (
          (seed.envelope.provenance as Record<string, unknown>).cost as Record<string, unknown>
        ).total = 99;
      },
    });
    expect(result.status).toBe("pass");
    expect(rules(result, "warning")).toContain("INTAKE-11");
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(false);
  });

  it("missing cost-report.json warns while status stays pass", async () => {
    const result = await buildAndValidate({
      mutate: (seed) => {
        seed.files.delete("cost-report.json");
      },
    });
    expect(result.status).toBe("pass");
    expect(rules(result, "warning")).toContain("INTAKE-11");
  });
});
