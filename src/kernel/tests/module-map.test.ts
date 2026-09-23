import { test, expect } from "vitest";
import {
  SITE_MODULE_MAP,
  WORKSHOP_MODULE_MAP,
  siteModuleLoaders,
  workshopModuleLoaders,
} from "../module-map.ts";

/*
<MODULE_CONTRACT>
<purpose>
  RFC-1148: integrity tests for the canonical SITE_MODULE_MAP — the engine-owned
  descriptor map every Sternsystem kernel.config delegates to. Guards the 18-key
  surface, descriptor shape, and loader materialization.
</purpose>
</MODULE_CONTRACT>
*/

const EXPECTED_SITE_KEYS = [
  "check",
  "service",
  "deploy",
  "integrity",
  "changelog",
  "pipelines",
  "onboarding",
  "testing",
  "rfc",
  "workflow",
  "compass",
  "naming",
  "werkstatt",
  "change-impact",
  "bordbuch",
  "nachweis",
  "sichtpass",
  "dns",
];

test("SITE_MODULE_MAP: exactly the 18 canonical site modules", () => {
  expect(Object.keys(SITE_MODULE_MAP).sort()).toEqual([...EXPECTED_SITE_KEYS].sort());
});

test("SITE_MODULE_MAP: every descriptor has spec + export", () => {
  for (const [key, descriptor] of Object.entries(SITE_MODULE_MAP)) {
    expect(descriptor.spec, `${key}.spec`).toBeTruthy();
    expect(descriptor.export, `${key}.export`).toBeTruthy();
    expect(descriptor.spec.startsWith("@warpgogol/"), `${key} spec`).toBe(true);
  }
});

test("siteModuleLoaders: returns a loader per SITE_MODULE_MAP key", () => {
  const loaders = siteModuleLoaders();
  expect(Object.keys(loaders).sort()).toEqual(Object.keys(SITE_MODULE_MAP).sort());
  for (const loader of Object.values(loaders)) {
    expect(typeof loader).toBe("function");
  }
});

test("workshopModuleLoaders: unchanged — still materializes WORKSHOP_MODULE_MAP", () => {
  const loaders = workshopModuleLoaders();
  const expected = [
    ...Object.keys(WORKSHOP_MODULE_MAP.engine),
    ...Object.keys(WORKSHOP_MODULE_MAP.sitePlugin),
    ...Object.keys(WORKSHOP_MODULE_MAP.forge),
  ].sort();
  expect(Object.keys(loaders).sort()).toEqual(expected);
});
