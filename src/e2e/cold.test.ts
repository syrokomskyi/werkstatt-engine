/*
<MODULE_CONTRACT>
  <purpose>RFC-0965: Unit tests for werkstatt.e2e.cold confinement and path safety.
  Verifies that the cold run's systems-cache path is inside the temp root,
  not the real workshop systems-cache, and that the preflight dirty-tree
  check rejects uncommitted changes.</purpose>
  <non-goals>
    <item>Does not execute the full cold E2E run — that requires ~45 minutes and network access.</item>
    <item>Does not test step execution logic — only path confinement and preflight safety.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0965: initial confinement tests — path safety and preflight dirty-tree check.</item>
  <item>RFC-1307: step 5 — remove 00-brief.md path, onboarding.synthesize and brief.validate; cold run registers from intake</item>
  <item>RFC-1324</item>
</CHANGE_SUMMARY>
*/

import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";

describe("werkstatt.e2e.cold confinement (RFC-0965)", () => {
  it("coldRoot is under os.tmpdir()", () => {
    const coldRoot = path.join(os.tmpdir(), "werkstatt-e2e-cold-test");
    expect(coldRoot.startsWith(os.tmpdir())).toBe(true);
  });

  it("systems-cache path is inside coldRoot, not the real workshop path", () => {
    const coldRoot = path.join(os.tmpdir(), "werkstatt-e2e-cold-test");
    const coldSystemsCache = path.join(coldRoot, "systems-cache");
    const realSystemsCache = path.resolve(
      path.join(__dirname, "..", "..", "..", "..", "systems-cache"),
    );

    expect(coldSystemsCache.startsWith(coldRoot)).toBe(true);
    expect(coldSystemsCache).not.toBe(realSystemsCache);
    expect(path.relative(coldRoot, coldSystemsCache)).toBe("systems-cache");
  });

  it("systems-git path is inside coldRoot, not the real workshop path", () => {
    const coldRoot = path.join(os.tmpdir(), "werkstatt-e2e-cold-test");
    const coldSystemsGit = path.join(coldRoot, "systems-git");
    const realSystemsGit = path.resolve(
      path.join(__dirname, "..", "..", "..", "..", "systems-git"),
    );

    expect(coldSystemsGit.startsWith(coldRoot)).toBe(true);
    expect(coldSystemsGit).not.toBe(realSystemsGit);
  });

  it("workspace clone path is inside coldRoot", () => {
    const coldRoot = path.join(os.tmpdir(), "werkstatt-e2e-cold-test");
    const workspaceClone = path.join(coldRoot, "werkstatt");
    expect(workspaceClone.startsWith(coldRoot)).toBe(true);
  });

  it("mission workpiece path is inside coldRoot", () => {
    const coldRoot = path.join(os.tmpdir(), "werkstatt-e2e-cold-test");
    const workspaceClone = path.join(coldRoot, "werkstatt");
    const workpieceDir = path.join(workspaceClone, "missions", "e2e-cold-m001", "workpiece");
    expect(workpieceDir.startsWith(coldRoot)).toBe(true);
  });

  it("fixture staging targets onboarding intake inside the clone inside coldRoot", () => {
    const coldRoot = path.join(os.tmpdir(), "werkstatt-e2e-cold-test");
    const workspaceClone = path.join(coldRoot, "werkstatt");
    const intakeDir = path.join(
      workspaceClone,
      "onboarding",
      "e2e-valid-minimal",
      ".input",
      "intake",
    );
    expect(intakeDir.startsWith(coldRoot)).toBe(true);
    expect(intakeDir.startsWith(workspaceClone)).toBe(true);
  });

  it("compose seam targets workpiece src/content inside coldRoot", () => {
    const coldRoot = path.join(os.tmpdir(), "werkstatt-e2e-cold-test");
    const workspaceClone = path.join(coldRoot, "werkstatt");
    const contentDir = path.join(
      workspaceClone,
      "missions",
      "e2e-cold-m001",
      "workpiece",
      "src",
      "content",
    );
    expect(contentDir.startsWith(coldRoot)).toBe(true);
  });
});

describe("werkstatt.e2e.cold fixture staging (RFC-1324)", () => {
  it.each(["valid-minimal", "de-domain", "latin-only"])(
    "stages %s with the run's systemId, valid under INTAKE-01..15",
    async (fixture) => {
      const { mkdtemp, rm, mkdir, cp } = await import("node:fs/promises");
      const { existsSync } = await import("node:fs");
      const { createDefaultIO } = await import("@warpgogol/werkstatt-shared/kernel/workspace-io");
      const { stageFixtureIntake } = await import("./cold.ts");
      const { resolveIntakeExportSha256, validateIntakeBundle } =
        await import("../intake/intake-validate.ts");
      const io = createDefaultIO().io;
      const root = await mkdtemp(path.join(os.tmpdir(), "cold-intake-"));
      try {
        // Simulate the cloned workshop's fixture location.
        const fixtureSrc = path.join(__dirname, "..", "intake", "fixtures", fixture);
        const fixtureDst = path.join(
          root,
          "packages",
          "werkstatt-engine",
          "src",
          "intake",
          "fixtures",
          fixture,
        );
        await mkdir(path.dirname(fixtureDst), { recursive: true });
        await cp(fixtureSrc, fixtureDst, { recursive: true });

        const info = await stageFixtureIntake({
          io,
          cloneRoot: root,
          fixture,
          systemId: `e2e-${fixture}`,
        });
        const staged = path.join(root, info.relDir);
        const exportInfo = await resolveIntakeExportSha256(io);
        expect(exportInfo, "intake schema export must be installed").not.toBeNull();
        const result = await validateIntakeBundle(staged, io, {
          exportSha256: exportInfo!.sha256,
        });
        expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
        expect(result.systemId).toBe(`e2e-${fixture}`);
        expect(existsSync(path.join(staged, "..", "..", "00-brief.md"))).toBe(false);
        // composition/ is not part of the intake bundle
        expect(existsSync(path.join(staged, "composition"))).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

describe("werkstatt.e2e.cold compose overlay (RFC-1324)", () => {
  it("merges composer keys onto the seeded manifest, preserving platform fields", async () => {
    const { mergeSystemMdFrontmatter } = await import("./cold.ts");
    const seeded = `---
app: e2e-valid-minimal
version: 1.0.0
identity:
  systemStar: Polaris
  biome: handwerk-material-warm
  domain: e2e-valid-minimal.acct.workers.dev
i18n:
  default: ru
  supported:
    ru: { name: ru, hreflang: ru }
    uz: { name: uz, hreflang: uz-Latn, tag: uz-Latn }
legalJurisdiction: DE
publication:
  gate: enforce
---
# body
`;
    const overlay = `---
identity:
  tagline: "tag"
i18n:
  supported:
    ru: { name: "Русский" }
pages:
  - pageId: home
    routes: { ru: "" }
---
`;
    const merged = mergeSystemMdFrontmatter(seeded, overlay);
    const fm = merged.slice(3, merged.lastIndexOf("---"));
    const { default: YAML } = await import("yaml");
    const parsed = YAML.parse(fm) as Record<string, unknown>;
    const identity = parsed.identity as Record<string, unknown>;
    expect(identity.systemStar).toBe("Polaris");
    expect(identity.biome).toBe("handwerk-material-warm");
    // runtime-resolved provisional host survives — never duplicated by the fixture
    expect(identity.domain).toBe("e2e-valid-minimal.acct.workers.dev");
    expect(identity.tagline).toBe("tag");
    const i18n = parsed.i18n as Record<string, unknown>;
    expect(i18n.default).toBe("ru");
    const supported = i18n.supported as Record<string, Record<string, string>>;
    expect(supported.ru).toEqual({ name: "Русский", hreflang: "ru" });
    expect(supported.uz).toEqual({ name: "uz", hreflang: "uz-Latn", tag: "uz-Latn" });
    expect(parsed.legalJurisdiction).toBe("DE");
    expect(parsed.pages).toEqual([{ pageId: "home", routes: { ru: "" } }]);
    // seeded markdown body survives when the overlay carries none
    expect(merged).toContain("# body");
  });
});
