/*
<MODULE_CONTRACT>
<purpose>RFC-1307 tests for sternsystem.register --intake: preconditions before
any write (AC-1, AC-2, AC-5), the deterministic seed planner (AC-3, AC-4, AC-6,
AC-10), and the system-state onboarding provenance block (AC-7).</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1307: created.</item>
  <item>RFC-1307: steps 3-4 — deterministic intake seed planner and sternsystem.register --intake --biome</item>
</CHANGE_SUMMARY>
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { intakeEnvelopeSchema } from "@warpgogol/werkstatt-shared/onboarding/intake";
import { registerDeps, runSternsystemRegister } from "./sternsystem-register.ts";
import { planSeedFromIntake, type IntakeSeedInput } from "./seed-from-intake.ts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "intake",
  "fixtures",
  "valid-minimal",
);

let workspaceRoot: string;

function input(flags: Record<string, unknown>): KernelCommandInput {
  return { flags: flags as KernelCommandInput["flags"], argv: [] };
}

function context(root: string): KernelRuntimeContext {
  return {
    io: createDefaultIO().io,
    workspaceRoot: root,
    logger: { section() {}, info() {}, warn() {}, error() {}, success() {} },
    dryRun: false,
  } as unknown as KernelRuntimeContext;
}

const baseFlags = () => ({
  id: "dp7",
  cosmicStar: "Achernar",
  mirrors: "../systems-cache/dp7:non-bare",
  intake: "onboarding/dp7/.input/intake",
  biome: "dp7-03",
});

const cacheDir = () => join(workspaceRoot, "..", "systems-cache", "dp7");

beforeEach(async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "register-intake-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(join(workspaceRoot, "onboarding", "dp7", ".input"), { recursive: true });
  await cp(FIXTURE, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  await writeFile(join(workspaceRoot, "package.json"), JSON.stringify({ version: "6.0.0" }));
  await writeFile(join(workspaceRoot, "werkstatt.identity.json"), "{}");
  process.env.SIGNING_PRIVATE_KEY = "deadbeef".repeat(8);
  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.SIGNING_PRIVATE_KEY;
  await rm(join(workspaceRoot, ".."), { recursive: true, force: true });
});

describe("sternsystem.register --intake preconditions (RFC-1307)", () => {
  it("AC-1: refuses an intake that fails onboarding.intake.validate without writing any file", async () => {
    const intakePath = join(workspaceRoot, "onboarding", "dp7", ".input", "intake", "intake.json");
    await writeFile(intakePath, (await readFile(intakePath, "utf8")).replace('"dp7"', '"dp7" '));
    await expect(
      runSternsystemRegister(input(baseFlags()), context(workspaceRoot)),
    ).rejects.toThrow(/fails onboarding\.intake\.validate/);
    expect(existsSync(join(cacheDir(), "system-config.yaml"))).toBe(false);
  });

  it("AC-2: a new registration without --intake names the missing flag", async () => {
    const { intake: _omit, ...flags } = baseFlags();
    await expect(runSternsystemRegister(input(flags), context(workspaceRoot))).rejects.toThrow(
      /requires --intake/,
    );
  });

  it("AC-2: a new registration without --biome names the missing flag", async () => {
    const { biome: _omit, ...flags } = baseFlags();
    await expect(runSternsystemRegister(input(flags), context(workspaceRoot))).rejects.toThrow(
      /requires --biome/,
    );
  });

  it("AC-5: refuses when intake.systemId differs from --id without writing any file", async () => {
    await mkdir(join(workspaceRoot, "onboarding", "other-site", ".input"), { recursive: true });
    await expect(
      runSternsystemRegister(
        input({
          ...baseFlags(),
          id: "other-site",
          mirrors: "../systems-cache/other-site:non-bare",
        }),
        context(workspaceRoot),
      ),
    ).rejects.toThrow(/differs from --id/);
    expect(
      existsSync(join(workspaceRoot, "..", "systems-cache", "other-site", "system-config.yaml")),
    ).toBe(false);
  });

  it("AC-5: refuses an unknown --biome without writing any file", async () => {
    vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(
      'BIOME-ID-01: biome "dp7-03" has no catalog file',
    );
    await expect(
      runSternsystemRegister(input(baseFlags()), context(workspaceRoot)),
    ).rejects.toThrow(/--biome 'dp7-03' rejected/);
    expect(existsSync(join(cacheDir(), "system-config.yaml"))).toBe(false);
  });

  it("rejects --intake together with --amend", async () => {
    await expect(
      runSternsystemRegister(
        input({ id: "dp7", amend: true, intake: "x" }),
        context(workspaceRoot),
      ),
    ).rejects.toThrow(/for new registrations/);
  });

  it("AC-7: records the intake provenance in system-state.yaml", async () => {
    vi.spyOn(registerDeps, "openMission").mockResolvedValue({
      data: { missionId: "dp7-m000001" },
      exitCode: 0,
    } as unknown as Awaited<ReturnType<typeof registerDeps.openMission>>);
    const result = await runSternsystemRegister(input(baseFlags()), context(workspaceRoot));
    expect(result.data?.status).toBe("pass");
    const state = YAML.parse(readFileSync(join(cacheDir(), "system-state.yaml"), "utf8"));
    expect(state.onboarding.intakeId).toMatch(/^int_/);
    expect(state.onboarding.intakeSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.data?.seed?.pbpDocuments).toBe(5);
  });
});

function seedInput(intakeJson: unknown): IntakeSeedInput {
  const intake = intakeEnvelopeSchema.parse(intakeJson);
  const assetBytes = new Map<string, Uint8Array>();
  for (const asset of intake.assets) {
    assetBytes.set(asset.id, readFileSync(join(FIXTURE, asset.file)));
  }
  return {
    intake,
    intakeSha256: `sha256:${"0".repeat(64)}`,
    systemId: "dp7",
    cosmicStar: "Achernar",
    biomeId: "dp7-03",
    assetBytes,
  };
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).reverse()) out[key] = reverseKeys(record[key]);
  return out;
}

const fixtureJson = () => JSON.parse(readFileSync(join(FIXTURE, "intake.json"), "utf8"));

function fileText(plan: ReturnType<typeof planSeedFromIntake>, path: string): string {
  const file = plan.files.find((f) => f.path === path);
  expect(file, `seed plan must contain ${path}`).toBeDefined();
  return typeof file!.content === "string"
    ? file!.content
    : new TextDecoder().decode(file!.content);
}

describe("planSeedFromIntake (RFC-1307)", () => {
  it("AC-3: seeds system.md i18n, jurisdiction and biome from the intake", () => {
    const plan = planSeedFromIntake(seedInput(fixtureJson()));
    const md = fileText(plan, "src/content/system.md");
    const fm = YAML.parse(md.slice(4, md.lastIndexOf("---")));
    expect(fm.i18n.default).toBe("ru");
    expect(fm.i18n.supported).toEqual({ ru: { name: "ru" }, uz: { name: "uz", tag: "uz-Latn" } });
    expect(fm.legalJurisdiction).toBe("DE");
    expect(fm.identity.biome).toBe("dp7-03");
    expect(fm.identity.domain, "an unconfirmed domain must stay unset").toBeUndefined();
  });

  it("AC-4: writes one PBP document per intake entity at the shared layout path", () => {
    const plan = planSeedFromIntake(seedInput(fixtureJson()));
    const paths = plan.files
      .map((f) => f.path)
      .filter((p) => p.endsWith(".md") && p.includes("business-profile"));
    expect(paths.sort()).toEqual([
      "src/content/business-profile/ru/business.md",
      "src/content/business-profile/ru/organization/dp7.md",
      "src/content/business-profile/ru/trust/claims/european-quality.md",
      "src/content/business-profile/ru/trust/claims/installation-warranty.md",
      "src/content/business-profile/ru/trust/evidence/src-01.md",
    ]);
    const draft = fileText(
      plan,
      "src/content/business-profile/ru/trust/claims/installation-warranty.md",
    );
    expect(draft).toContain("id: claim/installation-warranty");
    expect(draft).toContain("status: draft");
  });

  it("AC-6: two calls and a key-permuted intake yield byte-identical seeds", () => {
    const a = planSeedFromIntake(seedInput(fixtureJson()));
    const b = planSeedFromIntake(seedInput(fixtureJson()));
    const c = planSeedFromIntake(seedInput(reverseKeys(fixtureJson())));
    const bytes = (p: typeof a) =>
      p.files.map((f) => [
        f.path,
        typeof f.content === "string" ? f.content : Buffer.from(f.content).toString("hex"),
      ]);
    expect(bytes(b)).toEqual(bytes(a));
    expect(bytes(c), "seed bytes must not depend on intake key order (DNA-58)").toEqual(bytes(a));
  });

  it("AC-10: copies a generated asset byte-exact with a sibling credits file", () => {
    const plan = planSeedFromIntake(seedInput(fixtureJson()));
    const asset = plan.files.find(
      (f) => f.path === "src/content/business-profile/ru/assets/ast-01.svg",
    );
    expect(asset).toBeDefined();
    expect(
      Buffer.from(asset!.content as Uint8Array).equals(
        readFileSync(
          join(
            FIXTURE,
            "assets",
            "49e9c254c70f1678e2bc12aef76f65de59d3332b8de29dfcb61c52e7e0cc3227.svg",
          ),
        ),
      ),
    ).toBe(true);
    const credits = YAML.parse(
      fileText(plan, "src/content/business-profile/ru/assets/ast-01.credits.yaml"),
    );
    expect(credits.sourceType).toBe("ai-generated");
    expect(credits.parties[0].kind).toBe("AIModel");
  });
});
