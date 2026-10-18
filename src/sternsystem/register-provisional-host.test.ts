/*
<MODULE_CONTRACT>
<purpose>RFC-1325 tests for the provisional workers.dev birth path in
sternsystem.register: channel derivation + account cache (AC-2), worker-name
collision refusal (AC-3), and pre-write fail-fast ordering.</purpose>
<non-goals>
  <item>Intake seeding semantics — sternsystem-register-intake.test.ts owns those; this suite only varies the --domain host class.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1325: initial — derivation/collision/env/mismatch coverage with a stubbed Cloudflare adapter.</item>
  <item>RFC-1325: provisional workers.dev as first-class site host

Single host predicate module in werkstatt-shared; provisional registration derives dev/alt/main workers.dev channels from the account subdomain; first dev deploy auto-protects provisional hosts; provisional main responses carry noindex; dns-aid skips provisional sites; site.domain.adopt cuts over to a custom domain.</item>
</CHANGE_SUMMARY>
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { getWorkersSubdomain, listWorkerNames } from "../leitstand/adapters/cloudflare-api.ts";
import { registerDeps, runSternsystemRegister } from "./sternsystem-register.ts";

vi.mock("../leitstand/adapters/cloudflare-api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../leitstand/adapters/cloudflare-api.ts")>()),
  getWorkersSubdomain: vi.fn(async () => "syrokomskyi"),
  listWorkerNames: vi.fn(async () => [] as string[]),
}));

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
  domain: "dp7.syrokomskyi.workers.dev",
  biome: "dp7-03",
});

const cacheDir = () => join(workspaceRoot, "..", "systems-cache", "dp7");
const cacheFile = () => join(workspaceRoot, "werkstatt.cloudflare.json");

beforeEach(async () => {
  vi.clearAllMocks();
  const testRoot = await mkdtemp(join(tmpdir(), "register-prov-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(join(workspaceRoot, "onboarding", "dp7", ".input"), { recursive: true });
  await cp(FIXTURE, join(workspaceRoot, "onboarding", "dp7", ".input", "intake"), {
    recursive: true,
  });
  await writeFile(join(workspaceRoot, "package.json"), JSON.stringify({ version: "6.0.0" }));
  await writeFile(join(workspaceRoot, "werkstatt.identity.json"), "{}");
  process.env.SIGNING_PRIVATE_KEY = "deadbeef".repeat(8);
  process.env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
  process.env.CLOUDFLARE_API_TOKEN = "t".repeat(40);
  vi.spyOn(registerDeps, "checkBiome").mockResolvedValue(null);
  vi.mocked(getWorkersSubdomain).mockResolvedValue("syrokomskyi");
  vi.mocked(listWorkerNames).mockResolvedValue([]);
  vi.spyOn(registerDeps, "openMission").mockResolvedValue({
    data: { missionId: "dp7-m000001" },
    exitCode: 0,
  } as unknown as Awaited<ReturnType<typeof registerDeps.openMission>>);
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.SIGNING_PRIVATE_KEY;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  await rm(join(workspaceRoot, ".."), { recursive: true, force: true });
});

describe("sternsystem.register provisional host (RFC-1325)", () => {
  it("AC-2: derives deployment.channels and caches the account subdomain", async () => {
    const result = await runSternsystemRegister(input(baseFlags()), context(workspaceRoot));
    expect(result.data?.status).toBe("pass");

    const config = YAML.parse(readFileSync(join(cacheDir(), "system-config.yaml"), "utf8"));
    expect(config.deployment.adapter).toBe("cloudflare-workers");
    expect(config.deployment.channels).toEqual({
      dev: { workerName: "dev-dp7", url: "https://dev-dp7.syrokomskyi.workers.dev" },
      alt: { workerName: "alt-dp7", url: "https://alt-dp7.syrokomskyi.workers.dev" },
      main: { workerName: "dp7", url: "https://dp7.syrokomskyi.workers.dev" },
    });

    const cache = JSON.parse(readFileSync(cacheFile(), "utf8"));
    expect(cache).toEqual({ accountId: "a".repeat(32), workersSubdomain: "syrokomskyi" });
    expect(getWorkersSubdomain).toHaveBeenCalledOnce();
    expect(listWorkerNames).toHaveBeenCalledOnce();
  });

  it("AC-3: refuses on a worker-name collision before any write", async () => {
    vi.mocked(listWorkerNames).mockResolvedValue(["dev-dp7", "other"]);
    await expect(
      runSternsystemRegister(input(baseFlags()), context(workspaceRoot)),
    ).rejects.toThrow(/worker-name collision.*dev-dp7/);
    expect(existsSync(join(cacheDir(), "system-config.yaml"))).toBe(false);
  });

  it("fails fast naming the missing env before any write", async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    await expect(
      runSternsystemRegister(input(baseFlags()), context(workspaceRoot)),
    ).rejects.toThrow(/CLOUDFLARE_API_TOKEN/);
    expect(existsSync(join(cacheDir(), "system-config.yaml"))).toBe(false);
  });

  it("refuses a domain whose worker label differs from --id", async () => {
    await expect(
      runSternsystemRegister(
        input({ ...baseFlags(), domain: "other.syrokomskyi.workers.dev" }),
        context(workspaceRoot),
      ),
    ).rejects.toThrow(/worker 'other'.*--id is 'dp7'/);
    expect(existsSync(join(cacheDir(), "system-config.yaml"))).toBe(false);
  });

  it("refuses a domain on a different account subdomain", async () => {
    await expect(
      runSternsystemRegister(
        input({ ...baseFlags(), domain: "dp7.foreign.workers.dev" }),
        context(workspaceRoot),
      ),
    ).rejects.toThrow(/account subdomain 'foreign'.*resolves to 'syrokomskyi'/);
    expect(existsSync(join(cacheDir(), "system-config.yaml"))).toBe(false);
  });

  it("reuses the cached account subdomain without re-probing the API", async () => {
    await writeFile(
      cacheFile(),
      JSON.stringify({ accountId: "a".repeat(32), workersSubdomain: "syrokomskyi" }),
    );
    const result = await runSternsystemRegister(input(baseFlags()), context(workspaceRoot));
    expect(result.data?.status).toBe("pass");
    expect(getWorkersSubdomain).not.toHaveBeenCalled();
    expect(listWorkerNames).toHaveBeenCalledOnce();
  });
});
