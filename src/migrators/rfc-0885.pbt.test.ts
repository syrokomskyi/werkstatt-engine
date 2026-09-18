/*
<MODULE_CONTRACT>
  <purpose>RFC-0885: PBT test for the PBP evidence schema migrator —
  verifies idempotency (f(f(x)) == f(x)) over arbitrary consent frontmatter.</purpose>
  <keywords>RFC-0885, migrator, pbt, idempotency, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1105: initial PBT test for rfc-0885 migrator (validator requires adjacent pbt+snapshot pair).</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0885Migrator } from "./rfc-0885.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

const consentStatusArb = fc.constantFrom(
  "granted",
  "partially_granted",
  "revoked",
  "not_requested",
  "requested",
  "expired",
);

test("rfc-0885 migrator is idempotent over arbitrary consent status", async () => {
  await fc.asyncProperty(
    consentStatusArb,
    fc.option(
      fc.date().map((d) => d.toISOString()),
      { nil: null },
    ),
    async (status, grantedAt) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0885-pbt-"));
      try {
        const consentDir = path.join(dir, "src", "content", "business-profile", "de", "consent");
        await fs.mkdir(consentDir, { recursive: true });
        const filePath = path.join(consentDir, "c.md");
        await fs.writeFile(
          filePath,
          `---\nconsentStatus: ${status}\ngrantedAt: ${grantedAt === null ? "null" : grantedAt}\nmethod: written\n---\nBody`,
        );

        const data: SternsystemData = { rootPath: dir, dataPaths: [] };
        const once = await rfc0885Migrator.transform(data, ctx);
        const content1 = await fs.readFile(filePath, "utf8");
        await rfc0885Migrator.transform(once, ctx);
        const content2 = await fs.readFile(filePath, "utf8");

        expect(content2, "Migrator must be idempotent").toEqual(content1);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  );
});
