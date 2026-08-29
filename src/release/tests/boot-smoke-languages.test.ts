// @vitest-environment node
import { describe, it, expect } from "vitest";
import { detectBootSmokeLanguages } from "../boot-smoke.ts";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("detectBootSmokeLanguages", () => {
  it("returns fallback [de, uk] when dist/client/ does not exist", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-lang-noclient-"));
    const languages = await detectBootSmokeLanguages(tmpDist);
    expect(languages).toEqual(["de", "uk"]);
  });

  it("returns fallback [de, uk] when dist/client/ is empty", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-lang-empty-"));
    mkdirSync(join(tmpDist, "client"), { recursive: true });
    const languages = await detectBootSmokeLanguages(tmpDist);
    expect(languages).toEqual(["de", "uk"]);
  });

  it("detects de and uk directories", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-lang-deuk-"));
    const clientDir = join(tmpDist, "client");
    mkdirSync(join(clientDir, "de"), { recursive: true });
    mkdirSync(join(clientDir, "uk"), { recursive: true });
    const languages = await detectBootSmokeLanguages(tmpDist);
    expect(languages).toContain("de");
    expect(languages).toContain("uk");
    expect(languages).toHaveLength(2);
  });

  it("detects de, en, and uk directories", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-lang-deenuk-"));
    const clientDir = join(tmpDist, "client");
    for (const lang of ["de", "en", "uk"]) {
      mkdirSync(join(clientDir, lang), { recursive: true });
    }
    const languages = await detectBootSmokeLanguages(tmpDist);
    expect(languages).toContain("de");
    expect(languages).toContain("en");
    expect(languages).toContain("uk");
    expect(languages).toHaveLength(3);
  });

  it("excludes non-language directories (cosmic, textures, preview)", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-lang-nonlang-"));
    const clientDir = join(tmpDist, "client");
    mkdirSync(join(clientDir, "de"), { recursive: true });
    mkdirSync(join(clientDir, "cosmic"), { recursive: true });
    mkdirSync(join(clientDir, "textures"), { recursive: true });
    mkdirSync(join(clientDir, "preview"), { recursive: true });
    mkdirSync(join(clientDir, "nachweis-pdfs"), { recursive: true });
    const languages = await detectBootSmokeLanguages(tmpDist);
    expect(languages).toEqual(["de"]);
  });

  it("excludes directories starting with underscore (_astro, _img)", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-lang-underscore-"));
    const clientDir = join(tmpDist, "client");
    mkdirSync(join(clientDir, "de"), { recursive: true });
    mkdirSync(join(clientDir, "_astro"), { recursive: true });
    mkdirSync(join(clientDir, "_img"), { recursive: true });
    mkdirSync(join(clientDir, "_print"), { recursive: true });
    const languages = await detectBootSmokeLanguages(tmpDist);
    expect(languages).toEqual(["de"]);
  });

  it("excludes the api directory", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-lang-api-"));
    const clientDir = join(tmpDist, "client");
    mkdirSync(join(clientDir, "de"), { recursive: true });
    mkdirSync(join(clientDir, "api"), { recursive: true });
    const languages = await detectBootSmokeLanguages(tmpDist);
    expect(languages).toEqual(["de"]);
  });

  it("detects only language directories from mixed content", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-lang-mixed-"));
    const clientDir = join(tmpDist, "client");
    mkdirSync(join(clientDir, "de"), { recursive: true });
    mkdirSync(join(clientDir, "uk"), { recursive: true });
    mkdirSync(join(clientDir, "_astro"), { recursive: true });
    mkdirSync(join(clientDir, "api"), { recursive: true });
    mkdirSync(join(clientDir, "cosmic"), { recursive: true });
    mkdirSync(join(clientDir, "website"), { recursive: true });
    const languages = await detectBootSmokeLanguages(tmpDist);
    expect(languages).toContain("de");
    expect(languages).toContain("uk");
    expect(languages).toHaveLength(2);
  });

  it("excludes 3-letter directories (eng, deu)", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-lang-3letter-"));
    const clientDir = join(tmpDist, "client");
    mkdirSync(join(clientDir, "de"), { recursive: true });
    mkdirSync(join(clientDir, "eng"), { recursive: true });
    mkdirSync(join(clientDir, "deu"), { recursive: true });
    const languages = await detectBootSmokeLanguages(tmpDist);
    expect(languages).toEqual(["de"]);
  });

  it("excludes uppercase directories (DE, UK)", async () => {
    const tmpDist = mkdtempSync(join(tmpdir(), "boot-smoke-lang-upper-"));
    const clientDir = join(tmpDist, "client");
    mkdirSync(join(clientDir, "de"), { recursive: true });
    mkdirSync(join(clientDir, "DE"), { recursive: true });
    mkdirSync(join(clientDir, "UK"), { recursive: true });
    const languages = await detectBootSmokeLanguages(tmpDist);
    expect(languages).toEqual(["de"]);
  });
});
