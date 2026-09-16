/*
<MODULE_CONTRACT>
<purpose>Kernel configuration for {{APP_NAME}} — declares modules and pipelines.</purpose>
<non-goals>
  <item>Do not add business logic or runtime behavior here.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/
import { defineKernelConfig } from "@warpgogol/werkstatt-engine/kernel/types";

// moduleLoaders: each module is loaded lazily via dynamic import(), so that
// tsImport of this config file does not transitively import all module
// packages. The kernel runtime uses buildRegistryForModule() to load only
// the module that owns the requested command (manifest-driven), or
// buildRegistry() to load all modules when needed.
export default defineKernelConfig({
  name: "{{APP_NAME}}",
  description: "{{APP_NAME}} Astro site OS",
  moduleLoaders: {
    check: async () => (await import("./modules/check.module")).checkModule,
    service: async () => (await import("./modules/service.module")).serviceModule,
    deploy: async () => (await import("./modules/deploy.module")).deployModule,
    integrity: async () => (await import("./modules/integrity.module")).integrityModule,
    changelog: async () => (await import("./modules/changelog.module")).changelogModule,
    rfc: async () => (await import("@warpgogol/forge")).createForgeRfcModule(),
    workflow: async () => (await import("@warpgogol/forge")).createForgeWorkflowModule(),
    compass: async () => (await import("@warpgogol/forge")).forgeCompassModule,
    naming: async () => (await import("@warpgogol/forge")).createForgeNamingModule(),
    werkstatt: async () => (await import("@warpgogol/forge")).forgeWerkstattModule,
    "change-impact": async () => (await import("@warpgogol/werkstatt-engine/kernel")).createChangeImpactModule(),
    bordbuch: async () =>
      (await import("@warpgogol/werkstatt-engine/handoff")).createBordbuchModule(),
    nachweis: async () =>
      (await import("@warpgogol/werkstatt-engine/handoff")).createNachweisModule(),
    sichtpass: async () =>
      (await import("@warpgogol/werkstatt-engine/sichtpass-module")).createSichtpassModule(),
    dns: async () => (await import("@warpgogol/werkstatt-engine/dns-module")).createDnsModule(),
    onboarding: async () =>
      (await import("@warpgogol/werkstatt-site/onboarding")).createOnboardingModule(),
    testing: async () =>
      (await import("@warpgogol/werkstatt-site/testing/module")).createTestingModule(),
    pipelines: async () => (await import("./modules/pipelines.module")).pipelinesModule,
  },
});
