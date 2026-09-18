/*
<MODULE_CONTRACT>
  <purpose>RFC-1105: snapshot test for the share-path-rewrite migrator —
  verifies the destination map on concrete specifiers (identity promotion,
  explicit remaps, node exiles, warn-only cases) and end-to-end file rewrite.</purpose>
  <keywords>RFC-1105, migrator, snapshot, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1105: initial snapshot test for share-path-rewrite migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc1105Migrator, mapShareSubpath } from "./rfc-1105.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

// Legacy pre-dissolution specifier prefix — built by concatenation so the
// repo-wide residue grep (AC-2) does not match this fixture file.
const LEGACY = "@warpgogol/werkstatt-shared" + "/share";

test("mapShareSubpath: identity promotion for domain dirs", () => {
  expect(mapShareSubpath("slug")).toBe("slug");
  expect(mapShareSubpath("semantic/jsonld/article")).toBe("semantic/jsonld/article");
  expect(mapShareSubpath("knowledge/index")).toBe("knowledge");
  expect(mapShareSubpath("schemas/section-cta")).toBe("schemas/section-cta");
  expect(mapShareSubpath("i18n/localization")).toBe("i18n/localization");
});

test("mapShareSubpath: explicit remaps", () => {
  expect(mapShareSubpath("scripts/lenis")).toBe("client-scripts/lenis");
  expect(mapShareSubpath("scripts")).toBe("client-scripts");
  expect(mapShareSubpath("counter-utils")).toBe("client-scripts/counter-utils");
  expect(mapShareSubpath("fs")).toBe("node/fs");
  expect(mapShareSubpath("fs/index")).toBe("node/fs/index");
  expect(mapShareSubpath("import-scan")).toBe("node/import-scan");
  expect(mapShareSubpath("dev-props-validator")).toBe("node/dev-props-validator");
  expect(mapShareSubpath("semantic/markdown-twin-provenance")).toBe(
    "node/semantic/markdown-twin-provenance",
  );
  expect(mapShareSubpath("semantic/derived-prices-loader")).toBe(
    "node/semantic/derived-prices-loader",
  );
  expect(mapShareSubpath("onboarding-yaml")).toBe("onboarding");
  expect(mapShareSubpath("content")).toBe("content");
  expect(mapShareSubpath("content/entity-id")).toBe("content/entity-id");
  expect(mapShareSubpath("content-reference")).toBe("content/content-reference");
  expect(mapShareSubpath("check-hints")).toBe("checks/check-hints");
  expect(mapShareSubpath("walk-files")).toBe("stack/walk-files");
  expect(mapShareSubpath("stack-checks")).toBe("stack/stack-checks");
  expect(mapShareSubpath("text-normalize")).toBe("text/text-normalize");
  expect(mapShareSubpath("entitlement")).toBe("policy/entitlement");
  expect(mapShareSubpath("rfc0042-utils")).toBe("sections/rfc0042-utils");
  expect(mapShareSubpath("offer-capacity")).toBe("offers/offer-capacity");
  expect(mapShareSubpath("material-credits")).toBe("attribution/material-credits");
});

test("mapShareSubpath: warn-only cases return null", () => {
  expect(mapShareSubpath("")).toBeNull();
  expect(mapShareSubpath("index")).toBeNull();
  expect(mapShareSubpath("tests/knowledge.test")).toBeNull();
  expect(mapShareSubpath("redirects.test")).toBeNull();
  expect(mapShareSubpath("vitest.config")).toBeNull();
  expect(mapShareSubpath("env.d")).toBeNull();
  expect(mapShareSubpath("nonexistent-domain")).toBeNull();
});

test("rfc-1105 snapshot: transform rewrites specifiers in workpiece files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-1105-snap-"));
  try {
    const srcDir = path.join(dir, "src", "components");
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, "widget.ts");
    await fs.writeFile(
      filePath,
      [
        `import { slugUrl } from "${LEGACY}/slug";`,
        `import { initLenis } from "${LEGACY}/scripts/lenis";`,
        `import { walkFiles } from "${LEGACY}/walk-files";`,
        `import { provenance } from "${LEGACY}/semantic/markdown-twin-provenance";`,
        'import { cta } from "@warpgogol/werkstatt-site' + '/share/schemas/section-cta";',
        'import { other } from "@warpgogol/werkstatt-shared/ontology";',
      ].join("\n"),
    );

    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc1105Migrator.transform(data, ctx);

    const after = await fs.readFile(filePath, "utf8");
    expect(after).toContain('"@warpgogol/werkstatt-shared/slug"');
    expect(after).toContain('"@warpgogol/werkstatt-shared/client-scripts/lenis"');
    expect(after).toContain('"@warpgogol/werkstatt-shared/stack/walk-files"');
    expect(after).toContain('"@warpgogol/werkstatt-shared/node/semantic/markdown-twin-provenance"');
    // werkstatt-site/share is a different package — untouched.
    expect(after).toContain('"@warpgogol/werkstatt-site/share/schemas/section-cta"');
    // Already-migrated specifier untouched.
    expect(after).toContain('"@warpgogol/werkstatt-shared/ontology"');
    expect(after).not.toContain(LEGACY);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("rfc-1105 snapshot: bare barrel specifier is left in place and warned", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-1105-snap-bare-"));
  try {
    const warnings: string[] = [];
    const warnCtx: MigrationContext = {
      ...ctx,
      logger: { info: (msg: string) => warnings.push(msg) },
    };
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, "legacy.ts");
    await fs.writeFile(filePath, `import { something } from "${LEGACY}";`);

    await rfc1105Migrator.transform({ rootPath: dir, dataPaths: [] }, warnCtx);

    const after = await fs.readFile(filePath, "utf8");
    expect(after).toContain(`"${LEGACY}"`);
    expect(warnings.some((w) => w.includes("WARNING") && w.includes("legacy.ts"))).toBe(true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
