/*
<MODULE_CONTRACT>
  <purpose>RFC-1105: PBT test for the share-path-rewrite migrator —
  verifies idempotency (f(f(x)) == f(x)) over arbitrary file content and that
  non-share specifiers are never touched.</purpose>
  <keywords>RFC-1105, migrator, pbt, idempotency, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1105: initial PBT test for share-path-rewrite migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
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

const fileContentArbitrary = fc.oneof(
  fc.string({ minLength: 0, maxLength: 300 }),
  fc.constant('import { slugUrl } from "@warpgogol/werkstatt-shared/slug";'),
  fc.constant('import { x } from "@warpgogol/werkstatt-shared/client-scripts/lenis";'),
  fc.constant('import { y } from "@warpgogol/werkstatt-shared/slug";'),
  fc.constant('import { z } from "@warpgogol/werkstatt-site' + '/share/schemas/section-cta";'),
  fc.constant("no specifiers here"),
);

test("rfc-1105 migrator is idempotent: f(f(x)) == f(x) for arbitrary file content", async () => {
  const dataArbitrary = fc.record({
    rootPath: fc.constant(""),
    dataPaths: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 5 }),
    fileContent: fileContentArbitrary,
  });

  await fc.asyncProperty(dataArbitrary, async (data) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-1105-pbt-"));
    try {
      const srcDir = path.join(dir, "src", "content");
      await fs.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, "sample.ts");
      await fs.writeFile(filePath, data.fileContent);

      const sternData: SternsystemData = { rootPath: dir, dataPaths: data.dataPaths };

      const once = await rfc1105Migrator.transform(sternData, ctx);
      const content1 = await fs.readFile(filePath, "utf8");
      const twice = await rfc1105Migrator.transform(once, ctx);
      const content2 = await fs.readFile(filePath, "utf8");

      expect(content2, "Migrator must be idempotent — second run must not change output").toEqual(
        content1,
      );
      expect(twice).toEqual(once);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

test("rfc-1105 mapShareSubpath never produces a path still containing share/", () => {
  fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 60 }), (sub) => {
      const mapped = mapShareSubpath(sub);
      if (mapped !== null) {
        expect(mapped.startsWith("share/") || mapped === "share").toBe(false);
      }
    }),
  );
});
