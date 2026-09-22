/*
<MODULE_CONTRACT>
<purpose>Unit tests for werkstatt.platform.update (RFC-1125, AC-4) — pnpm command selection, version transition reporting, and pinnedPlatform drift detection.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1125: initial platform-update tests (AC-4 evidence).</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { platformUpdate } from "./platform-update.ts";

function makeDeps(overrides: {
  from?: string | null;
  to?: string | null;
  systems?: Array<{ id: string; pinnedPlatform: string }>;
  exec?: (cmd: string, cwd: string) => void;
}) {
  const calls: string[] = [];
  let versionCalls = 0;
  return {
    calls,
    deps: {
      exec: overrides.exec ?? ((cmd: string) => void calls.push(cmd)),
      installedVersion: async () => {
        versionCalls += 1;
        return versionCalls === 1 ? (overrides.from ?? null) : (overrides.to ?? null);
      },
      listSystems: async () => overrides.systems ?? [],
    },
  };
}

test("--to latest runs pnpm up -rL @warpgogol/*", async () => {
  const { calls, deps } = makeDeps({ from: "1.0.0", to: "1.0.0" });
  await platformUpdate("/ws", "latest", deps);
  expect(calls).toEqual(['pnpm up -rL "@warpgogol/*"']);
});

test("--to <semver> runs pnpm up -r @warpgogol/*@<semver>", async () => {
  const { calls, deps } = makeDeps({ from: "1.0.0", to: "6.317.0" });
  await platformUpdate("/ws", "6.317.0", deps);
  expect(calls).toEqual(['pnpm up -r "@warpgogol/*@6.317.0"']);
});

test("reports changed=true and from→to when version moves", async () => {
  const { deps } = makeDeps({ from: "6.316.0", to: "6.317.0" });
  const result = await platformUpdate("/ws", "latest", deps);
  expect(result.changed).toBe(true);
  expect(result.from).toBe("6.316.0");
  expect(result.to).toBe("6.317.0");
});

test("idempotent — changed=false when already at target", async () => {
  const { deps } = makeDeps({ from: "6.317.0", to: "6.317.0" });
  const result = await platformUpdate("/ws", "latest", deps);
  expect(result.changed).toBe(false);
});

test("reports systems whose pinnedPlatform drifts from the new version", async () => {
  const { deps } = makeDeps({
    from: "6.316.0",
    to: "6.317.0",
    systems: [
      { id: "acme", pinnedPlatform: "6.316.0" },
      { id: "beta", pinnedPlatform: "6.317.0" },
    ],
  });
  const result = await platformUpdate("/ws", "latest", deps);
  expect(result.driftedSystems).toEqual([{ id: "acme", pinnedPlatform: "6.316.0" }]);
});

test("no drift reported when installed version is unreadable", async () => {
  const { deps } = makeDeps({
    from: null,
    to: null,
    systems: [{ id: "acme", pinnedPlatform: "6.316.0" }],
  });
  const result = await platformUpdate("/ws", "latest", deps);
  expect(result.driftedSystems).toEqual([]);
});
