/*
<MODULE_CONTRACT>
  <purpose>RFC-0560: Unit tests for actor identity resolution logic.</purpose>
  <keywords>RFC-0560, actor-identity, test, env-var, auth</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0560: initial unit tests for resolveActorFromEnv and resolveActor.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { resolveActorFromEnv, resolveActor } from "./actor-identity.ts";
import type { KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    argv: [],
    flags: flags as Record<string, boolean | string | string[]>,
  };
}

const ENV_VARS = ["WERKSTATT_ACTOR_ID", "WERKSTATT_ACTOR_SITE", "WERKSTATT_ACTOR_SCOPES"];

beforeEach(() => {
  for (const key of ENV_VARS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_VARS) delete process.env[key];
});

test("resolveActorFromEnv returns null when env vars are not set", () => {
  expect(resolveActorFromEnv()).toBeNull();
});

test("resolveActorFromEnv returns ActorIdentity when WERKSTATT_ACTOR_ID and WERKSTATT_ACTOR_SITE are set", () => {
  process.env["WERKSTATT_ACTOR_ID"] = "did:key:z6Mktest";
  process.env["WERKSTATT_ACTOR_SITE"] = "warpgogol-com";
  const identity = resolveActorFromEnv();
  expect(identity).toEqual({
    actorId: "did:key:z6Mktest",
    siteId: "warpgogol-com",
    scopes: [],
  });
});

test("resolveActorFromEnv returns null when only WERKSTATT_ACTOR_ID is set", () => {
  process.env["WERKSTATT_ACTOR_ID"] = "did:key:z6Mktest";
  expect(resolveActorFromEnv()).toBeNull();
});

test("resolveActorFromEnv parses scopes from comma-separated WERKSTATT_ACTOR_SCOPES", () => {
  process.env["WERKSTATT_ACTOR_ID"] = "did:key:z6Mktest";
  process.env["WERKSTATT_ACTOR_SITE"] = "warpgogol-com";
  process.env["WERKSTATT_ACTOR_SCOPES"] = "mission:open,mission:close, mission:abort";
  const identity = resolveActorFromEnv();
  expect(identity?.scopes).toEqual(["mission:open", "mission:close", "mission:abort"]);
});

test("resolveActor returns 'unknown' when neither flag is set", () => {
  expect(resolveActor(makeInput({}))).toBe("unknown");
});

test("resolveActor returns --actor flag value when set", () => {
  expect(resolveActor(makeInput({ actor: "human:alice" }))).toBe("human:alice");
});

test("resolveActor returns env actorId when --actor-from-auth is set and env vars are present", () => {
  process.env["WERKSTATT_ACTOR_ID"] = "did:key:z6Mktest";
  process.env["WERKSTATT_ACTOR_SITE"] = "warpgogol-com";
  expect(resolveActor(makeInput({ "actor-from-auth": true }))).toBe("did:key:z6Mktest");
});

test("resolveActor throws actor-required error when --actor-from-auth is set but env vars are missing", () => {
  expect(() => resolveActor(makeInput({ "actor-from-auth": true }))).toThrow(/actor-required/);
});

test("resolveActor: --actor-from-auth takes precedence over --actor", () => {
  process.env["WERKSTATT_ACTOR_ID"] = "did:key:z6Mktest";
  process.env["WERKSTATT_ACTOR_SITE"] = "warpgogol-com";
  expect(resolveActor(makeInput({ "actor-from-auth": true, actor: "human:alice" }))).toBe(
    "did:key:z6Mktest",
  );
});
