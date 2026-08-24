/*
<MODULE_CONTRACT>
<purpose>RFC-0548: snapshot test for the rfc-0548 migrator — verifies that
running the migrator on a fixture produces a consistent backup file.</purpose>
<non-goals>
  <item>Do not test idempotency — that is covered by the PBT.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0548: initial snapshot test for rfc-0548 migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rfc0548Migrator } from "../migrators/rfc-0548.ts";
import type { SternsystemData, MigrationContext } from "../migrators/types.ts";

function makeCtx(): MigrationContext {
  return {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };
}

test("rfc-0548 migrator snapshot — generated AGENTS.md backup", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rfc-0548-snap-"));
  try {
    const agentsContent = [
      "<!-- generated-by: forge.agents.generate -->",
      "# Agent Guide: test-project",
      "",
      "## Project",
      "- **Name:** test-project",
    ].join("\n");

    fs.writeFileSync(path.join(dir, "AGENTS.md"), agentsContent, "utf8");

    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0548Migrator.transform(data, makeCtx());

    const backup = fs.readFileSync(path.join(dir, "AGENTS.md.bak"), "utf8");
    expect(backup).toMatchInlineSnapshot(`
      "<!-- generated-by: forge.agents.generate -->
      # Agent Guide: test-project

      ## Project
      - **Name:** test-project"
    `);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rfc-0548 migrator snapshot — hand-written AGENTS.md backup only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rfc-0548-snap-"));
  try {
    const agentsContent = [
      "# Agent Guide",
      "",
      "This is a hand-written AGENTS.md with no generated marker.",
      "It should be backed up but not modified.",
    ].join("\n");

    fs.writeFileSync(path.join(dir, "AGENTS.md"), agentsContent, "utf8");

    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    await rfc0548Migrator.transform(data, makeCtx());

    // AGENTS.md unchanged
    const after = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(after).toBe(agentsContent);

    // Backup matches original
    const backup = fs.readFileSync(path.join(dir, "AGENTS.md.bak"), "utf8");
    expect(backup).toMatchInlineSnapshot(`
      "# Agent Guide

      This is a hand-written AGENTS.md with no generated marker.
      It should be backed up but not modified."
    `);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rfc-0548 migrator snapshot — no AGENTS.md is a no-op", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rfc-0548-snap-"));
  try {
    const data: SternsystemData = { rootPath: dir, dataPaths: [] };
    const result = await rfc0548Migrator.transform(data, makeCtx());

    expect(result.rootPath).toBe(dir);
    expect(fs.existsSync(path.join(dir, "AGENTS.md.bak"))).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
