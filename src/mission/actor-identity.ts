/*
<MODULE_CONTRACT>
<purpose>RFC-0560: Actor identity resolution for mission commands — env-var propagation from Studio Gate auth context.</purpose>
<non-goals>
  <item>Does not define VC credential verification — that is RFC-0558/RFC-0559.</item>
  <item>Does not define commit signing — see signed-commit.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0560: initial actor identity type and resolution logic.</item>
</CHANGE_SUMMARY>
*/

import type { KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";

export interface ActorIdentity {
  actorId: string;
  siteId: string;
  scopes: string[];
}

export function resolveActorFromEnv(): ActorIdentity | null {
  const actorId = process.env["WERKSTATT_ACTOR_ID"];
  const siteId = process.env["WERKSTATT_ACTOR_SITE"];
  if (!actorId || !siteId) return null;
  const scopesRaw = process.env["WERKSTATT_ACTOR_SCOPES"];
  const scopes = scopesRaw
    ? scopesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return { actorId, siteId, scopes };
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBoolean(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true;
}

export function resolveActor(input: KernelCommandInput): string {
  const useAuth = flagBoolean(input, "actor-from-auth");
  const explicitActor = flagString(input, "actor");

  if (useAuth) {
    const identity = resolveActorFromEnv();
    if (!identity) {
      throw new Error(
        "[actor-required] --actor-from-auth was set but WERKSTATT_ACTOR_ID/WERKSTATT_ACTOR_SITE env vars are not set. Studio Gate auth middleware must set these before dispatching commands.",
      );
    }
    if (explicitActor) {
      process.stderr.write(
        `[warn] --actor-from-auth takes precedence over --actor; --actor value "${explicitActor}" ignored.\n`,
      );
    }
    return identity.actorId;
  }

  if (explicitActor) return explicitActor;

  return "unknown";
}
