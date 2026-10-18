/*
<MODULE_CONTRACT>
<purpose>
RFC-1325: provisional workers.dev host birth support — resolve the account's
workers.dev subdomain, verify the passed --domain lives on the account, refuse
worker-name collisions before the first write, and derive the deployment block
written into system-config.yaml. The resolution result is cached in the
git-tracked werkstatt.cloudflare.json so later births and adopters need no
re-probe.
</purpose>
<non-goals>
  <item>Worker upload/deploy — leitstand + cloudflare-workers.ts own that.</item>
  <item>Domain adoption after birth — site.domain.adopt owns that.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>workerName convention: main = systemId, dev = dev-&lt;systemId&gt;, alt = alt-&lt;systemId&gt; — matches the channelHost() provisional derivation (worker name IS the host label).</item>
  <item>werkstatt.cloudflare.json lives at the workspace root and is git-tracked — it describes the workshop's single Cloudflare account, not a per-system secret.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1325: initial — deriveProvisionalDeployment, account cache read/write, collision refusal.</item>
  <item>RFC-1325: provisional workers.dev as first-class site host

Single host predicate module in werkstatt-shared; provisional registration derives dev/alt/main workers.dev channels from the account subdomain; first dev deploy auto-protects provisional hosts; provisional main responses carry noindex; dns-aid skips provisional sites; site.domain.adopt cuts over to a custom domain.</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";
import { join } from "node:path";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { channelHost } from "@warpgogol/werkstatt-shared/middleware/site-host";
import { getWorkersSubdomain, listWorkerNames } from "../leitstand/adapters/cloudflare-api.ts";

const CACHE_FILE = "werkstatt.cloudflare.json";

const cloudflareAccountCacheSchema = z.object({
  accountId: z.string().min(1),
  workersSubdomain: z.string().min(1),
});

export type CloudflareAccountCache = z.infer<typeof cloudflareAccountCacheSchema>;

export interface ProvisionalDeployment {
  adapter: "cloudflare-workers";
  channels: {
    dev: { workerName: string; url: string };
    alt: { workerName: string; url: string };
    main: { workerName: string; url: string };
  };
}

/** Schema-checked read of the cached account record; null when absent. */
export async function readCloudflareAccountCache(
  io: WorkspaceIO,
  workspaceRoot: string,
): Promise<CloudflareAccountCache | null> {
  const path = join(workspaceRoot, CACHE_FILE);
  if (!(await io.exists(path))) return null;
  const parsed = cloudflareAccountCacheSchema.safeParse(JSON.parse(await io.readFile(path)));
  if (!parsed.success) {
    throw new Error(
      `[sternsystem.register] ${CACHE_FILE} is malformed — fix or delete it so register can re-resolve (${parsed.error.issues[0]?.message ?? "schema mismatch"})`,
    );
  }
  return parsed.data;
}

async function writeCloudflareAccountCache(
  io: WorkspaceIO,
  workspaceRoot: string,
  cache: CloudflareAccountCache,
): Promise<void> {
  await io.writeFile(join(workspaceRoot, CACHE_FILE), `${JSON.stringify(cache, null, 2)}\n`);
}

/**
 * Resolve and verify a provisional birth domain, then derive the deployment
 * block. Throws before any caller write:
 * - env missing: `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` (named);
 * - the domain's account slug disagrees with the live API subdomain;
 * - `<id>`, `dev-<id>`, or `alt-<id>` already exists as a Worker script.
 * On success the account record is (re)cached at workspaceRoot.
 */
export async function deriveProvisionalDeployment(
  systemId: string,
  domain: string,
  io: WorkspaceIO,
  workspaceRoot: string,
  env: Record<string, string>,
): Promise<ProvisionalDeployment> {
  const parts = domain.split(".");
  if (parts.length !== 4 || parts[2] !== "workers" || parts[3] !== "dev") {
    throw new Error(
      `[sternsystem.register] provisional --domain '${domain}' must have the <worker>.<account>.workers.dev shape`,
    );
  }
  const [workerLabel, domainSubdomain] = parts;
  if (workerLabel !== systemId) {
    throw new Error(
      `[sternsystem.register] provisional --domain '${domain}' names worker '${workerLabel}' but --id is '${systemId}' — on workers.dev the worker name IS the host label; pass --domain ${systemId}.${domainSubdomain}.workers.dev`,
    );
  }

  const accountId = env["CLOUDFLARE_ACCOUNT_ID"];
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  const missing = [
    ...(!accountId ? ["CLOUDFLARE_ACCOUNT_ID"] : []),
    ...(!apiToken ? ["CLOUDFLARE_API_TOKEN"] : []),
  ];
  if (missing.length > 0) {
    throw new Error(
      `[sternsystem.register] provisional host '${domain}' needs ${missing.join(" and ")} in the environment to verify the account subdomain and check worker-name collisions`,
    );
  }

  const cached = await readCloudflareAccountCache(io, workspaceRoot);
  let workersSubdomain =
    cached !== null && cached.accountId === accountId ? cached.workersSubdomain : null;
  if (workersSubdomain === null) {
    workersSubdomain = await getWorkersSubdomain(accountId!, apiToken!);
    await writeCloudflareAccountCache(io, workspaceRoot, {
      accountId: accountId!,
      workersSubdomain,
    });
  }

  if (workersSubdomain !== domainSubdomain) {
    throw new Error(
      `[sternsystem.register] --domain '${domain}' lives on account subdomain '${domainSubdomain}' but CLOUDFLARE_ACCOUNT_ID resolves to '${workersSubdomain}' — pass the matching account's credentials or fix --domain`,
    );
  }

  const wanted = {
    dev: `dev-${workerLabel}`,
    alt: `alt-${workerLabel}`,
    main: workerLabel,
  };
  const existing = new Set(await listWorkerNames(accountId!, apiToken!));
  const collisions = Object.entries(wanted).filter(([, name]) => existing.has(name));
  if (collisions.length > 0) {
    const listed = collisions.map(([ch, name]) => `${ch}: '${name}'`).join(", ");
    throw new Error(
      `[sternsystem.register] worker-name collision on account '${workersSubdomain}' — ${listed} already exist; choose another --domain/--id or delete the stale Workers`,
    );
  }

  const host = (channel: "dev" | "alt" | "main") =>
    channelHost("provisional-workers-dev", domain, channel, wanted[channel]);
  return {
    adapter: "cloudflare-workers",
    channels: {
      dev: { workerName: wanted.dev, url: `https://${host("dev")}` },
      alt: { workerName: wanted.alt, url: `https://${host("alt")}` },
      main: { workerName: wanted.main, url: `https://${domain}` },
    },
  };
}
