/*
<MODULE_CONTRACT>
<purpose>RFC-1307 tests for sternsystem.register --intake: preconditions before
any write (AC-1, AC-2, AC-5), the deterministic seed planner (AC-3, AC-4, AC-6,
AC-10), and the system-state onboarding provenance block (AC-7).</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1307: add register --domain for intakes without a confirmed domain</item>
  <item>RFC-1307: seed default operator config files at registration</item>
  <item>RFC-1307: seed intake assets into the pages domain so page credits match</item>
  <item>RFC-1307: seed the platform CSP sink allowlist disposition at registration</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
  <history>REVIEW-CODE-2026, RFC-1307</history>
</CHANGE_SUMMARY>
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  domain: "dp7.example.org",
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
  vi.spyOn(registerDeps, "provisionExternal").mockResolvedValue({
    ok: true,
    provisioned: ["cloudflare.token.check", "agent.search.index.create"],
  });
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

  it("refuses an intake without a confirmed domain when --domain is absent, without writing any file", async () => {
    const { domain: _omit, ...flags } = baseFlags();
    await expect(runSternsystemRegister(input(flags), context(workspaceRoot))).rejects.toThrow(
      /no confirmed domain/,
    );
    expect(existsSync(join(cacheDir(), "system-config.yaml"))).toBe(false);
  });

  it("refuses a --domain that is not a bare host name", async () => {
    await expect(
      runSternsystemRegister(
        input({ ...baseFlags(), domain: "https://dp7.example.org/" }),
        context(workspaceRoot),
      ),
    ).rejects.toThrow(/not a bare lowercase host name/);
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
    const systemMd = readFileSync(join(cacheDir(), "src", "content", "system.md"), "utf8");
    expect(systemMd).toContain("domain: dp7.example.org");
    expect(readFileSync(join(cacheDir(), "src", "image-delivery.config.yaml"), "utf8")).toContain(
      "overrides: []",
    );
    expect(existsSync(join(cacheDir(), ".lighthouse-budget-ignore"))).toBe(true);
    expect(readFileSync(join(cacheDir(), "src", "csp-sinks.allowlist.yaml"), "utf8")).toContain(
      "_astro/schemas.*.js",
    );
  });

  it("initialises a missing cache clone repo with origin at the local bare mirror", async () => {
    const bareDir = join(workspaceRoot, "..", "systems-git", "dp7");
    await mkdir(bareDir, { recursive: true });
    execFileSync("git", ["init", "--bare", "-b", "main", bareDir]);
    vi.spyOn(registerDeps, "openMission").mockResolvedValue({
      data: { missionId: "dp7-m000001" },
      exitCode: 0,
    } as unknown as Awaited<ReturnType<typeof registerDeps.openMission>>);
    const result = await runSternsystemRegister(
      input({ ...baseFlags(), mirrors: "../systems-cache/dp7:non-bare,../systems-git/dp7:bare" }),
      context(workspaceRoot),
    );
    expect(result.data?.status).toBe("pass");
    const origin = execFileSync("git", ["-C", cacheDir(), "remote", "get-url", "origin"], {
      encoding: "utf8",
    }).trim();
    expect(origin).toBe(bareDir);
    const log = execFileSync("git", ["-C", cacheDir(), "log", "--format=%s"], { encoding: "utf8" });
    expect(log).toContain("sternsystem.register: scaffold dp7");
  });

  it("removes a register-initialised cache clone repo on rollback", async () => {
    vi.spyOn(registerDeps, "openMission").mockRejectedValue(new Error("materialize failed"));
    const result = await runSternsystemRegister(input(baseFlags()), context(workspaceRoot));
    expect(result.data?.status).toBe("fail");
    expect(existsSync(join(cacheDir(), ".git"))).toBe(false);
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
    expect(fm.i18n.supported).toEqual({
      ru: { name: "ru", hreflang: "ru" },
      uz: { name: "uz", hreflang: "uz-Latn", tag: "uz-Latn" },
    });
    expect(fm.legalJurisdiction).toBe("DE");
    expect(fm.publication.gate).toBe("enforce");
    expect(fm.contractTerms.gate).toBe("enforce");
    expect(fm.provenance.gate).toBe("enforce");
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
      "src/content/business-profile/ru/organization/legal-identity.md",
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

  it("singleton types keep type-named files: brand + legal-identity on the same slug do not collide", () => {
    const json = fixtureJson();
    json.pbp.push({
      schema: "pbp/brand@1",
      id: "brand/dp7",
      type: "brand",
      status: "published",
      name: "DP7",
      ownerBusinessRef: { ref: "business/dp7" },
    });
    const plan = planSeedFromIntake(seedInput(json));
    expect(fileText(plan, "src/content/business-profile/ru/organization/brand.md")).toContain(
      "id: brand/dp7",
    );
    expect(
      fileText(plan, "src/content/business-profile/ru/organization/legal-identity.md"),
    ).toContain("id: legal-identity/dp7");
  });

  it("rejects two entities resolving to the same document path", () => {
    const json = fixtureJson();
    json.pbp.push({
      schema: "pbp/claim@1",
      id: "claim/european-quality",
      type: "claim",
      status: "draft",
      claimClass: "factual",
      claimKind: "fact",
      subject: { kind: "business", name: "DP7" },
      statement: "dup",
      statementLang: "ru",
      governance: { authorityRef: "pbp/business@1:business/dp7" },
    });
    expect(() => planSeedFromIntake(seedInput(json))).toThrow(/duplicate seed path/);
  });

  it("rejects an entity id that does not yield a kebab-case slug", () => {
    const json = fixtureJson();
    json.pbp[3].id = "claim/Bad Slug";
    expect(() => planSeedFromIntake(seedInput(json))).toThrow(/kebab-case slug/);
  });

  it("rejects two locale tags sharing a primary segment (REVIEW-08 N3)", () => {
    const json = fixtureJson();
    json.classification.locales[0].tag = "de-DE";
    json.classification.locales.push({
      tag: "de-CH",
      role: "secondary",
      sourceLanguageBy: "translation",
      reviewer: "studio",
    });
    expect(() => planSeedFromIntake(seedInput(json))).toThrow(/share primary segment 'de'/);
  });

  it("rejects a locale whose primary subtag is not a 2-letter segment (REVIEW-08 N4)", () => {
    const json = fixtureJson();
    json.classification.locales[0].tag = "eng";
    expect(() => planSeedFromIntake(seedInput(json))).toThrow(/primary subtag 'eng'/);
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
    const asset = plan.files.find((f) => f.path === "src/content/pages/ru/assets/ast-01.svg");
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
    const credits = YAML.parse(fileText(plan, "src/content/pages/ru/assets/ast-01.credits.yaml"));
    expect(credits.sourceType).toBe("ai-generated");
    expect(credits.parties[0].kind).toBe("AIModel");
    expect(credits.target.domain).toBe("pages");
  });
});
