/*
<MODULE_CONTRACT>
<purpose>RFC-1120: unit tests for feature disclosure — inventory union across system.md frontmatter, system-config deployment, content-tree markers, dist markers, and opportunistic entitlements; verdict mapping; feature-notes.md rendering.</purpose>
<non-goals>
  <item>Do not test export wiring — covered by tests-handoff integration tests.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1120: initial feature-notes tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { buildFeatureInventory, renderFeatureNotes } from "../feature-notes.ts";

let siteDir: string;
let distDir: string;

async function writeSystemMd(frontmatter: Record<string, unknown>): Promise<void> {
  const dir = join(siteDir, "src", "content");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "system.md"), `---\n${stringifyYaml(frontmatter)}---\n\n`, "utf8");
}

async function inventory(systemConfig: Record<string, unknown> = {}) {
  return buildFeatureInventory({ siteDir, distDir, systemConfig });
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "na-features-"));
  siteDir = join(root, "site");
  distDir = join(root, "dist");
  await mkdir(join(siteDir, "src", "content"), { recursive: true });
  await mkdir(distDir, { recursive: true });
});

afterEach(async () => {
  await rm(join(siteDir, ".."), { recursive: true, force: true });
});

test("detects entitlementsOverride features from system.md frontmatter", async () => {
  await writeSystemMd({ entitlementsOverride: ["portal", "nachweis"] });
  const features = await inventory();
  const ids = features.map((f) => f.feature);
  expect(ids).toContain("portal");
  expect(ids).toContain("nachweis");
  // unknown ids default to needs-backend (fail-honest)
  expect(features.find((f) => f.feature === "nachweis")?.verdict).toBe("needs-backend");
});

test("detects integrations from system.md frontmatter as needs-backend", async () => {
  await writeSystemMd({ integrations: { matomo: { enabled: true }, uchat: {} } });
  const features = await inventory();
  expect(features.find((f) => f.feature === "integrations.matomo")?.verdict).toBe(
    "needs-backend",
  );
  expect(features.find((f) => f.feature === "integrations.uchat")?.verdict).toBe("needs-backend");
});

test("detects worker-serving from deployment.adapter in system-config", async () => {
  await writeSystemMd({});
  const features = await inventory({ deployment: { adapter: "cloudflare-workers" } });
  expect(features.find((f) => f.feature === "worker-serving")?.verdict).toBe("needs-backend");
});

test("detects worker-serving from dist/_worker.js marker", async () => {
  await writeSystemMd({});
  await writeFile(join(distDir, "_worker.js"), "export default {}\n", "utf8");
  const features = await inventory();
  expect(features.find((f) => f.feature === "worker-serving")?.verdict).toBe("needs-backend");
});

test("detects portal-routes from src/content/portal tree marker", async () => {
  await writeSystemMd({});
  await mkdir(join(siteDir, "src", "content", "portal"), { recursive: true });
  const features = await inventory();
  expect(features.find((f) => f.feature === "portal-routes")?.verdict).toBe("needs-backend");
});

test("maps currency-auto-refresh to frozen-at-export", async () => {
  await writeSystemMd({ entitlementsOverride: ["currency-auto-refresh"] });
  const features = await inventory();
  expect(features.find((f) => f.feature === "currency-auto-refresh")?.verdict).toBe(
    "frozen-at-export",
  );
});

test("reads entitlements.generated.yaml opportunistically when present", async () => {
  await writeSystemMd({});
  await writeFile(
    join(siteDir, "src", "entitlements.generated.yaml"),
    stringifyYaml({ features: ["portal"] }) + "\n",
    "utf8",
  );
  const features = await inventory();
  expect(features.map((f) => f.feature)).toContain("portal");
});

test("returns empty inventory for a fully static site", async () => {
  await writeSystemMd({});
  const features = await inventory();
  expect(features).toEqual([]);
});

test("renderFeatureNotes is non-empty with zero features", async () => {
  const md = renderFeatureNotes({
    systemId: "sys",
    releaseId: "sys-r1",
    exportedAt: "2026-09-21T00:00:00Z",
    features: [],
  });
  expect(md.trim().length).toBeGreaterThan(0);
  expect(md).toContain("fully static");
});

test("renderFeatureNotes emits a table row per feature", async () => {
  const md = renderFeatureNotes({
    systemId: "sys",
    releaseId: "sys-r1",
    exportedAt: "2026-09-21T00:00:00Z",
    features: [
      { feature: "worker-serving", verdict: "needs-backend", detail: "Worker serving." },
      { feature: "currency-auto-refresh", verdict: "frozen-at-export", detail: "Frozen." },
    ],
  });
  expect(md).toContain("| `worker-serving` | needs-backend |");
  expect(md).toContain("| `currency-auto-refresh` | frozen-at-export |");
});
