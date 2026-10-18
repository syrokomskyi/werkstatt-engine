/*
<MODULE_CONTRACT>
<purpose>RFC-1326 AC-5: sternsystem.register runs provisionExternalResources
after mission.open while m000001 is still open — the Vectorize index the born
site's wrangler binds is ensured before register returns. A missing Cloudflare
permission fails the birth hard (rollback) with the permission named.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
<CHANGE_SUMMARY>
  <item>RFC-1326: initial — provision invocation order, success, failure rollback.</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
</CHANGE_SUMMARY>
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { registerDeps, runSternsystemRegister } from "./sternsystem-register.ts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "intake",
  "fixtures",
  "valid-minimal",
);

let workspaceRoot: string;

function input(flags: Record<string, unknown>): KernelCommandInput {
  return { flags: flags as KernelCommandInput["flags"], argv: [] };
}

function context(root: string): KernelRuntimeContext {
  return {
    io: createDefaultIO().io,
    workspaceRoot: root,
    logger: { section() {}, info() {}, warn() {}, error() {}, success() {} },
    dryRun: false,
  } as unknown as KernelRuntimeContext;
}

const baseFlags = () => ({
  id: "dp7",
  cosmicStar: "Achernar",
  mirrors: "../systems-cache/dp7:non-bare",
  intake: "onboarding/dp7/.input/intake",
  domain: "dp7.example.org",
  biome: "dp7-03",
});

const cacheDir = () => join(workspaceRoot, "..", "systems-cache", "dp7");

beforeEach(async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "register-provision-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(join(workspaceRoot, "onboarding", "dp7", ".input"), { recursive: true });
  await cp(FIXTURE, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  await writeFile(join(workspaceRoot, "package.json"), JSON.stringify({ version: "6.0.0" }));
  await writeFile(join(workspaceRoot, "werkstatt.identity.json"), "{}");
  process.env.SIGNING_PRIVATE_KEY = "deadbeef".repeat(8);
  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.spyOn(registerDeps, "openMission").mockResolvedValue({
    data: { missionId: "dp7-m000001" },
    exitCode: 0,
  } as unknown as Awaited<ReturnType<typeof registerDeps.openMission>>);
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.SIGNING_PRIVATE_KEY;
  await rm(join(workspaceRoot, ".."), { recursive: true, force: true });
});

describe("sternsystem.register external resource provisioning (RFC-1326)", () => {
  it("AC-5: births a site whose Vectorize index is provisioned while m000001 is open", async () => {
    const order: string[] = [];
    vi.spyOn(registerDeps, "openMission").mockImplementation(async () => {
      order.push("mission.open");
      return {
        data: { missionId: "dp7-m000001" },
        exitCode: 0,
      } as unknown as Awaited<ReturnType<typeof registerDeps.openMission>>;
    });
    const provision = vi
      .spyOn(registerDeps, "provisionExternal")
      .mockImplementation(async (_context, opts) => {
        order.push("provision");
        expect(opts.systemId).toBe("dp7");
        expect(opts.missionOpen).toBe(true);
        return { ok: true, provisioned: ["cloudflare.token.check", "agent.search.index.create"] };
      });

    const result = await runSternsystemRegister(input(baseFlags()), context(workspaceRoot));

    expect(result.data?.status).toBe("pass");
    expect(provision).toHaveBeenCalledOnce();
    // Provisioning runs after mission.open — the index-create command is
    // mutating and would fail the mission gate otherwise.
    expect(order.indexOf("mission.open")).toBeLessThan(order.indexOf("provision"));
    // The born site's wrangler template binds <id>-search — registering the
    // site is what creates it, so the index exists from birth.
    expect(existsSync(join(cacheDir(), "system-config.yaml"))).toBe(true);
  });

  it("a missing required permission fails the birth and names it — rollback leaves no site", async () => {
    vi.spyOn(registerDeps, "provisionExternal").mockResolvedValue({
      ok: false,
      provisioned: ["cloudflare.token.check"],
      error:
        "cloudflare.token.check failed: CFPERM-02 missing required permission " +
        "account.vectorize.edit — add the named permission to the token and re-run",
    });

    const result = await runSternsystemRegister(input(baseFlags()), context(workspaceRoot));

    expect(result.data?.status).toBe("fail");
    const detail = [result.summary, ...(result.data?.diagnostics ?? [])].join("\n");
    expect(detail).toMatch(/external resource provisioning failed/);
    expect(detail).toMatch(/account\.vectorize\.edit/);
    expect(existsSync(join(cacheDir(), "system-config.yaml"))).toBe(false);
  });

  it("a provisioning command failure fails the birth with the command named", async () => {
    vi.spyOn(registerDeps, "provisionExternal").mockResolvedValue({
      ok: false,
      provisioned: ["cloudflare.token.check"],
      error: "agent.search.index.create failed: wrangler exited 1",
    });

    const result = await runSternsystemRegister(input(baseFlags()), context(workspaceRoot));

    expect(result.data?.status).toBe("fail");
    const detail = [result.summary, ...(result.data?.diagnostics ?? [])].join("\n");
    expect(detail).toMatch(/agent\.search\.index\.create failed/);
    expect(existsSync(join(cacheDir(), "system-config.yaml"))).toBe(false);
  });
});
