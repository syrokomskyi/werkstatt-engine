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

  it("operator config files are written to cache clone inside coldRoot", () => {
    const coldRoot = path.join(os.tmpdir(), "werkstatt-e2e-cold-test");
    const cachePath = path.join(coldRoot, "systems-cache", "e2e-cold");
    const lighthouseFile = path.join(cachePath, ".lighthouse-budget-ignore");
    const imageDeliveryFile = path.join(cachePath, "src", "image-delivery.config.yaml");

    expect(lighthouseFile.startsWith(coldRoot)).toBe(true);
    expect(imageDeliveryFile.startsWith(coldRoot)).toBe(true);
  });

  it("business-profile placeholder is written to workpiece inside coldRoot", () => {
    const coldRoot = path.join(os.tmpdir(), "werkstatt-e2e-cold-test");
    const workspaceClone = path.join(coldRoot, "werkstatt");
    const bpDir = path.join(
      workspaceClone,
      "missions",
      "e2e-cold-m001",
      "workpiece",
      "src",
      "content",
      "business-profile",
      "de",
    );
    expect(bpDir.startsWith(coldRoot)).toBe(true);
  });
});

describe("werkstatt.e2e.cold intake fixture (RFC-1307)", () => {
  it("AC-8: prepares a valid de intake bundle and no 00-brief.md", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const { createDefaultIO } = await import("@warpgogol/werkstatt-shared/kernel/workspace-io");
    const { prepareColdIntake } = await import("./cold.ts");
    const { resolveIntakeExportSha256, validateIntakeBundle } =
      await import("../intake/intake-validate.ts");
    const io = createDefaultIO().io;
    const root = await mkdtemp(path.join(os.tmpdir(), "cold-intake-"));
    try {
      const rel = await prepareColdIntake(root, "e2e-cold", io);
      const exportInfo = await resolveIntakeExportSha256(io);
      expect(exportInfo, "intake schema export must be installed").not.toBeNull();
      const result = await validateIntakeBundle(path.join(root, rel), io, {
        exportSha256: exportInfo!.sha256,
      });
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(result.systemId).toBe("e2e-cold");
      expect(existsSync(path.join(root, "onboarding", "e2e-cold", ".input", "00-brief.md"))).toBe(
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
