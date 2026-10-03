/*
<MODULE_CONTRACT>
<purpose>
RFC-1188: resolve the platform's Web Bot Auth outbound signer for leitstand's
fleet fetches. PASSPORT_SIGNING_KEY (identity site's .env first, ambient env as
fallback) + the active passport kid + the identity origin → createWbaSigner +
createOutboundAgentClient. The signer identity is the platform's canonical
site: WBA_IDENTITY_SITE overrides, otherwise the probed systemId signs (the
fleet-internal loop verifies end-to-end against our own directories).
Unconfigured resolves to a signer-less client — the call still carries the
identifying User-Agent and is never broken by missing key material.
</purpose>
<non-goals>
  <item>Does not decide WHICH call sites sign — callers opt in per fetch.</item>
  <item>Does not verify inbound signatures — inbound WBA stays edge-delegated (ADR-0098).</item>
  <item>Does not manage key rotation — passport.key.rotate owns that.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1188: initial outbound signer resolver for leitstand fleet fetches.</item>
  <item>RFC-1188: Web Bot Auth outbound identity: wba-sign primitives, directory emit+sweep, AGS-WBA-01, leitstand signed fetches</item>
  <item>RFC-1188: review hardening — AGS-WBA-01 validates every published key, wba-signer fail-soft on unresolvable appDir</item>
</CHANGE_SUMMARY>
*/

import { createRequire } from "node:module";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  createOutboundAgentClient,
  createWbaSigner,
  WBA_DIRECTORY_PATH,
  type OutboundAgentClient,
  type WbaSigner,
} from "@warpgogol/werkstatt-shared/agent/wba-sign";
import { PassportPublicKeyFileSchema } from "@warpgogol/werkstatt-shared/passport/schema";
import { optionalEnv, readEnvFileValue } from "../integrity/signing.ts";
import {
  readSystemConfigSmart,
  resolveActiveWorkpieceDir,
  resolveCacheClonePath,
} from "../sternsystem/registry-io.ts";

const ENGINE_VERSION = (createRequire(import.meta.url)("../../package.json") as { version: string })
  .version;

const PASSPORT_PUBLIC_KEY_FILE = "public/.well-known/cosmic-passport-key.json";

export interface OutboundSignerResolution {
  client: OutboundAgentClient;
  /** "signed" when key material + kid + origin all resolved, else "degraded". */
  mode: "signed" | "degraded";
  /** Why degraded — for operator-visible logging. Absent when signed. */
  reason?: string;
}

/**
 * Resolve the outbound agent client for fleet fetches originating from the
 * platform toward system `systemId`. Env: WBA_IDENTITY_SITE (identity system,
 * defaults to the probed system), PASSPORT_SIGNING_KEY (hex private key,
 * identity site's .env authoritative).
 */
export async function resolveOutboundAgentClient(
  workspaceRoot: string,
  systemId?: string,
  fetchImpl?: typeof fetch,
): Promise<OutboundSignerResolution> {
  const identityId = process.env.WBA_IDENTITY_SITE?.trim() || systemId;
  // The active mission workpiece carries the freshest .env + key material —
  // mirror readSystemConfigSmart's preference so the signer tracks mission
  // state rather than the (possibly older) cache clone.
  let appDir: string;
  try {
    appDir =
      (identityId && (await resolveActiveWorkpieceDir(workspaceRoot, identityId))) ??
      resolveCacheClonePath(workspaceRoot, identityId ?? "");
  } catch {
    appDir = resolveCacheClonePath(workspaceRoot, identityId ?? "");
  }

  let origin: string | null = null;
  if (identityId) {
    try {
      const config = await readSystemConfigSmart(workspaceRoot, identityId);
      origin = config.deployment?.channels?.main?.url ?? null;
    } catch {
      origin = null;
    }
  }
  const directoryUrl = origin ? `${origin.replace(/\/+$/, "")}${WBA_DIRECTORY_PATH}` : null;
  const userAgent = directoryUrl
    ? `WarpgogolBot/${ENGINE_VERSION} (+${directoryUrl})`
    : `WarpgogolBot/${ENGINE_VERSION}`;

  const fail = (reason: string): OutboundSignerResolution => ({
    client: createOutboundAgentClient({ userAgent, fetchImpl }),
    mode: "degraded",
    reason,
  });

  let privateKeyHex: string | undefined;
  try {
    privateKeyHex =
      (await readEnvFileValue("PASSPORT_SIGNING_KEY", appDir)) ??
      (await optionalEnv("PASSPORT_SIGNING_KEY", appDir)) ??
      process.env["PASSPORT_SIGNING_KEY"];
  } catch {
    privateKeyHex = process.env["PASSPORT_SIGNING_KEY"];
  }
  if (!privateKeyHex) return fail("PASSPORT_SIGNING_KEY not configured");

  if (!origin) return fail(`no main channel URL for identity site '${identityId}'`);

  const keyFilePath = appDir ? join(appDir, PASSPORT_PUBLIC_KEY_FILE) : "";
  if (!keyFilePath || !existsSync(keyFilePath)) {
    return fail(`no cosmic-passport-key.json for identity site '${identityId}'`);
  }
  let kid: string;
  try {
    const keyFile = PassportPublicKeyFileSchema.parse(
      JSON.parse(readFileSync(keyFilePath, "utf8")),
    );
    const active = keyFile.keys.find((k) => k.active);
    if (!active) return fail(`no active key for identity site '${identityId}'`);
    kid = active.version;
  } catch {
    return fail(`unparseable cosmic-passport-key.json for '${identityId}'`);
  }

  const signer: WbaSigner = createWbaSigner({
    privateKeyHex,
    keyId: kid,
    directoryUrl: directoryUrl!,
    userAgent,
  });
  return {
    client: createOutboundAgentClient({
      signer,
      userAgent,
      fetchImpl,
      onSigningFailure: () => undefined,
    }),
    mode: "signed",
  };
}
