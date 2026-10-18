/*
<MODULE_CONTRACT>
<purpose>
RFC-1326 acceptance tests for loadWorkshopEnvAllowlisted — AC-6 (a kernel
key absent from the process environment is read from the workshop .env),
AC-7 (a non-allow-listed key in the workshop .env never reaches
process.env — the LANGUAGETOOL_URL fixture), exported-var-wins precedence,
and missing-.env tolerance. All tests inject targetEnv — process.env is
never mutated.
</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1326: initial — AC-6/AC-7 cases + precedence/tolerance invariants.</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
  <item>RFC-1326: review-fix pass — siteName targeting for app-scoped provisioning, allow-list completion</item>
</CHANGE_SUMMARY>
*/

import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { loadWorkshopEnvAllowlisted } from "./workshop-env.ts";

let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
});

async function fixture(envContent?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "workshop-env-"));
  roots.push(root);
  if (envContent !== undefined) {
    await writeFile(join(root, ".env"), envContent);
  }
  return root;
}

describe("loadWorkshopEnvAllowlisted (RFC-1326)", () => {
  test("AC-6: an allow-listed key absent from the environment loads from .env", async () => {
    const root = await fixture("CLOUDFLARE_API_TOKEN=cf-token-123\nCLOUDFLARE_ACCOUNT_ID=acc-1\n");
    const target: Record<string, string | undefined> = {};

    const result = await loadWorkshopEnvAllowlisted(root, createDefaultIO().io, target);

    expect(result.envFileFound).toBe(true);
    expect(target.CLOUDFLARE_API_TOKEN).toBe("cf-token-123");
    expect(target.CLOUDFLARE_ACCOUNT_ID).toBe("acc-1");
    expect(result.loaded.sort()).toEqual(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
  });

  test("AC-7: LANGUAGETOOL_URL and other site/service keys never reach the environment", async () => {
    const root = await fixture(
      [
        "CLOUDFLARE_API_TOKEN=cf-token-123",
        "LANGUAGETOOL_URL=http://localhost:8010",
        "LAGEBILD_API_KEY=lb-key",
        "GH_TOKEN=gh-secret",
        "OPENAI_API_KEY=sk-test",
        "UPSTASH_REDIS_REST_URL=https://upstash.example",
        "SEARCH_REINDEX_TOKEN=reindex-secret",
        "STRIPE_SECRET_KEY=sk_live_x",
        "FLEET_OWNERSHIP_REGISTRY_URL=https://registry.example",
        "R2_AXIOM_ACCOUNT_ID=r2-acc",
      ].join("\n"),
    );
    const target: Record<string, string | undefined> = {};

    const result = await loadWorkshopEnvAllowlisted(root, createDefaultIO().io, target);

    expect(target.CLOUDFLARE_API_TOKEN).toBe("cf-token-123");
    expect(target.R2_AXIOM_ACCOUNT_ID).toBe("r2-acc");
    // RFC-1326: workspace commands read FLEET_OWNERSHIP_REGISTRY_* and
    // UPSTASH_REDIS_REST_* (agent.registration.* ops) — both are allow-listed,
    // unlike site/service secrets.
    expect(target.FLEET_OWNERSHIP_REGISTRY_URL).toBe("https://registry.example");
    expect(target.UPSTASH_REDIS_REST_URL).toBe("https://upstash.example");
    for (const denied of [
      "LANGUAGETOOL_URL",
      "LAGEBILD_API_KEY",
      "GH_TOKEN",
      "OPENAI_API_KEY",
      "SEARCH_REINDEX_TOKEN",
      "STRIPE_SECRET_KEY",
    ]) {
      expect(target[denied], denied).toBeUndefined();
    }
    expect(result.loaded.sort()).toEqual([
      "CLOUDFLARE_API_TOKEN",
      "FLEET_OWNERSHIP_REGISTRY_URL",
      "R2_AXIOM_ACCOUNT_ID",
      "UPSTASH_REDIS_REST_URL",
    ]);
  });

  test("an exported variable always wins — .env never overrides process env", async () => {
    const root = await fixture("CLOUDFLARE_API_TOKEN=dotenv-value\n");
    const target: Record<string, string | undefined> = {
      CLOUDFLARE_API_TOKEN: "exported-value",
    };

    const result = await loadWorkshopEnvAllowlisted(root, createDefaultIO().io, target);

    expect(target.CLOUDFLARE_API_TOKEN).toBe("exported-value");
    expect(result.loaded).toEqual([]);
    expect(result.skipped).toContain("CLOUDFLARE_API_TOKEN");
  });

  test("missing .env is tolerated — no keys loaded, no throw", async () => {
    const root = await fixture();
    const target: Record<string, string | undefined> = {};

    const result = await loadWorkshopEnvAllowlisted(root, createDefaultIO().io, target);

    expect(result.envFileFound).toBe(false);
    expect(result.loaded).toEqual([]);
  });
});
