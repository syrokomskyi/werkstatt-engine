/*
<MODULE_CONTRACT>
<purpose>RFC-0505: snapshot test for the rfc-0505 migrator — verifies the
claim record content and sidecar deletion match expected snapshots after
migration on a clean run.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0505: initial snapshot test for rfc-0505 migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0505Migrator } from "./rfc-0505.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const SAMPLE_SIDECAR = `claim-001:
  provenance: manual
  asOf: "2026-07-23"
  sourceId: src-001
  url: "https://example.com"
  title: "Test Source"
`;

test("rfc-0505 migrator snapshot — claim record after migration", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0505-snap-"));
  const data: SternsystemData = { rootPath: tmpDir, dataPaths: [] };
  const ctx: MigrationContext = {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };

  try {
    const articleDir = path.join(tmpDir, "src", "content", "surface", "articles", "de");
    await fs.mkdir(articleDir, { recursive: true });
    await fs.writeFile(
      path.join(articleDir, "website-kosten.claims.yaml"),
      SAMPLE_SIDECAR,
      "utf-8",
    );

    await rfc0505Migrator.transform(data, ctx);

    const claimRecordPath = path.join(
      tmpDir,
      "src",
      "content",
      "surface",
      "claims",
      "de",
      "claim-001.md",
    );
    const content = await fs.readFile(claimRecordPath, "utf-8");
    expect(content).toMatchInlineSnapshot(`
      "---
      claimId: claim-001
      articleId: website-kosten
      claimText: Migrated from claim sidecar — editorial review required.
      claimType: factual
      sourceRefs:
        - sourceId: src-001
          url: https://example.com
          title: Test Source
          retrievedAt: 2026-07-23
      calculationInputs: []
      limitations: []
      verifiedAt: 2026-07-23
      reviewStatus: unverified
      ---
      "
    `);

    // Sidecar should be deleted
    const sidecarExists = await fs
      .stat(path.join(articleDir, "website-kosten.claims.yaml"))
      .then(() => true)
      .catch(() => false);
    expect(sidecarExists).toBe(false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
