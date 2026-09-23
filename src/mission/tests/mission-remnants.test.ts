/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1139 AC-6: mission.open's pre-flight cleanup reports non-empty
    missions/<id>/ dirs lacking mission.yaml as stale remnants with a
    cleanup hint — instead of the generic "non-empty real directory" warn.
  </purpose>
</MODULE_CONTRACT>
*/

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupStaleMissionEntries } from "../mission-open.ts";

describe("mission.open — RFC-1139 stale remnant detection", () => {
  let root: string;
  const warns: string[] = [];
  const logger = {
    info: () => {},
    warn: (msg: string) => warns.push(msg),
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mission-remnant-"));
    warns.length = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("AC-6: non-empty dir without mission.yaml is reported as a stale remnant", async () => {
    const remnant = join(root, "missions", "acme-m000148", "workpiece-failed");
    await mkdir(remnant, { recursive: true });
    await writeFile(join(remnant, "failure-report.json"), "{}\n", "utf8");

    const result = await cleanupStaleMissionEntries(root, logger);

    expect(result.skipped).toContain("missions/acme-m000148");
    expect(result.removedPaths).not.toContain("missions/acme-m000148");
    const remnantWarn = warns.find((w) => w.includes("acme-m000148"));
    expect(remnantWarn).toBeDefined();
    expect(remnantWarn).toContain("Stale mission remnant");
    expect(remnantWarn).toContain("mission.archive --clean-orphans");
  });

  it("non-empty dir WITH mission.yaml keeps the generic skip warning", async () => {
    const live = join(root, "missions", "acme-m000149");
    await mkdir(live, { recursive: true });
    await writeFile(join(live, "mission.yaml"), "missionId: acme-m000149\n", "utf8");

    const result = await cleanupStaleMissionEntries(root, logger);

    expect(result.skipped).toContain("missions/acme-m000149");
    const warn = warns.find((w) => w.includes("acme-m000149"));
    expect(warn).toBeDefined();
    expect(warn).toContain("Skipping non-empty real directory");
    expect(warn).not.toContain("Stale mission remnant");
  });

  it("empty dirs are still cleaned without remnant reporting", async () => {
    await mkdir(join(root, "missions", "acme-m000150"), { recursive: true });

    const result = await cleanupStaleMissionEntries(root, logger);

    expect(result.removedPaths).toContain("missions/acme-m000150");
    expect(warns.some((w) => w.includes("Stale mission remnant"))).toBe(false);
  });
});
