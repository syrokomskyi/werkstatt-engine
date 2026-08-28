/*
<MODULE_CONTRACT>
<purpose>RFC-0967: Fleet ownership registry client logic. Provides register,
verify, and transfer functions that call the fleet-ownership-registry Worker.
Reads passport from cache clone and sends it to the registry.</purpose>
<non-goals>
  <item>Does not implement the Worker — that lives in services/fleet-ownership-registry/.</item>
  <item>Does not store secrets — only identity claims are transmitted.</item>
  <item>Does not auto-discover registry URL — out-of-band operator config via FLEET_OWNERSHIP_REGISTRY_URL.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0967: initial client logic — registerOwnership, verifyOwnership, transferOwnership, deriveInstanceId.</item>
</CHANGE_SUMMARY>
*/

import { createHash } from "node:crypto";
import { readPassport } from "../sternsystem/registry-io.ts";
import type { SignedSitePassport } from "../sternsystem/passport.ts";

export interface OwnershipClaim {
  passportHash: string;
  systemId: string;
  creatorIdentity: string;
  instanceId: string;
  claimedAt: string;
  bordbuchHead: string;
  supersededBy: string | null;
}

export interface RegisterResult {
  registered: boolean;
  claim: OwnershipClaim;
  conflict: { existingClaim: OwnershipClaim | null } | null;
}

export interface VerifyResult {
  registered: boolean;
  claim: OwnershipClaim | null;
  conflictsWith: string | null;
}

export interface TransferResult {
  transferred: boolean;
  previousClaim: OwnershipClaim;
  newClaim: OwnershipClaim;
}

export class OwnershipError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "OwnershipError";
  }
}

export function deriveInstanceId(publicKey: string): string {
  return createHash("sha256").update(publicKey, "utf8").digest("hex").slice(0, 16);
}

function getRegistryUrl(explicit?: string): string {
  const url = explicit ?? process.env.FLEET_OWNERSHIP_REGISTRY_URL;
  if (!url) {
    throw new OwnershipError(
      "OWNERSHIP-01",
      "FLEET_OWNERSHIP_REGISTRY_URL is not set — cannot reach fleet ownership registry",
    );
  }
  return url.replace(/\/+$/, "");
}

function getRegistryToken(): string | undefined {
  return process.env.FLEET_OWNERSHIP_REGISTRY_TOKEN;
}

function authHeaders(): Record<string, string> {
  const token = getRegistryToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return headers;
}

function mapClaim(raw: Record<string, unknown>): OwnershipClaim {
  return {
    passportHash: raw.passportHash as string,
    systemId: raw.systemId as string,
    creatorIdentity: raw.creatorIdentity as string,
    instanceId: raw.instanceId as string,
    claimedAt: raw.claimedAt as string,
    bordbuchHead: raw.bordbuchHead as string,
    supersededBy: (raw.supersededBy as string | null) ?? null,
  };
}

export async function registerOwnership(input: {
  systemId: string;
  werkstattRoot: string;
  registryUrl?: string;
}): Promise<RegisterResult> {
  const { systemId, werkstattRoot } = input;
  const baseUrl = getRegistryUrl(input.registryUrl);

  const passport = await readPassport(werkstattRoot, systemId);
  if (!passport) {
    throw new OwnershipError(
      "OWNERSHIP-01",
      `passport.json not found for ${systemId} — run: pnpm exec werkstatt run sternsystem.passport.generate --id ${systemId}`,
    );
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/register`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ passport }),
    });
  } catch (err) {
    throw new OwnershipError(
      "OWNERSHIP-02",
      `Registry unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (response.status === 409) {
    const conflict = body.conflict as { existingClaim?: Record<string, unknown> } | undefined;
    return {
      registered: false,
      claim: null as unknown as OwnershipClaim,
      conflict: {
        existingClaim: conflict?.existingClaim
          ? mapClaim(conflict.existingClaim as Record<string, unknown>)
          : null,
      },
    };
  }

  if (response.status === 400 && body.error === "OWNERSHIP-04") {
    throw new OwnershipError(
      "OWNERSHIP-04",
      "Invalid passport signature — Ed25519 verification failed",
    );
  }

  if (!response.ok) {
    throw new OwnershipError(
      "OWNERSHIP-02",
      `Registry error (${response.status}): ${body.message ?? body.error ?? "unknown"}`,
    );
  }

  const claim = mapClaim(body.claim as Record<string, unknown>);
  return {
    registered: true,
    claim,
    conflict: null,
  };
}

export async function verifyOwnership(input: {
  systemId: string;
  werkstattRoot: string;
  registryUrl?: string;
}): Promise<VerifyResult> {
  const { systemId, werkstattRoot } = input;
  const baseUrl = getRegistryUrl(input.registryUrl);

  const passport = await readPassport(werkstattRoot, systemId);
  if (!passport) {
    return {
      registered: false,
      claim: null,
      conflictsWith: null,
    };
  }

  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/verify?passportHash=${encodeURIComponent(passport.passportHash)}`,
      {
        method: "GET",
        headers: authHeaders(),
      },
    );
  } catch (err) {
    throw new OwnershipError(
      "OWNERSHIP-02",
      `Registry unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    throw new OwnershipError(
      "OWNERSHIP-02",
      `Registry error (${response.status})`,
    );
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!body.registered) {
    return {
      registered: false,
      claim: null,
      conflictsWith: null,
    };
  }

  const claim = mapClaim(body.claim as Record<string, unknown>);
  return {
    registered: true,
    claim,
    conflictsWith: claim.instanceId !== deriveInstanceId(passport.payload.creator.publicKey)
      ? claim.instanceId
      : null,
  };
}

export async function transferOwnership(input: {
  systemId: string;
  werkstattRoot: string;
  registryUrl?: string;
  authorizationPath: string;
}): Promise<TransferResult> {
  const { systemId, werkstattRoot, authorizationPath } = input;
  const baseUrl = getRegistryUrl(input.registryUrl);

  const passport = await readPassport(werkstattRoot, systemId);
  if (!passport) {
    throw new OwnershipError(
      "OWNERSHIP-01",
      `passport.json not found for ${systemId}`,
    );
  }

  const { readFile } = await import("node:fs/promises");
  let authorization: unknown;
  try {
    const authRaw = await readFile(authorizationPath, "utf8");
    authorization = JSON.parse(authRaw);
  } catch (err) {
    throw new OwnershipError(
      "OWNERSHIP-05",
      `Cannot read authorization file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const instanceId = deriveInstanceId(passport.payload.creator.publicKey);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/transfer`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        authorization,
        newClaim: {
          passportHash: passport.passportHash,
          creatorIdentity: passport.payload.creator.identity,
          instanceId,
          bordbuchHead: passport.payload.provenance.bordbuchHead,
          systemId: passport.payload.systemId,
        },
      }),
    });
  } catch (err) {
    throw new OwnershipError(
      "OWNERSHIP-02",
      `Registry unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const code = body.error === "OWNERSHIP-05" ? "OWNERSHIP-05" : "OWNERSHIP-02";
    throw new OwnershipError(
      code,
      `Transfer failed (${response.status}): ${body.message ?? body.error ?? "unknown"}`,
    );
  }

  return {
    transferred: true,
    previousClaim: mapClaim(body.previousClaim as Record<string, unknown>),
    newClaim: mapClaim(body.newClaim as Record<string, unknown>),
  };
}

export type { SignedSitePassport };
