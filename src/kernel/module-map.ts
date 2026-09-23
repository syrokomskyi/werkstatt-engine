/*
<MODULE_CONTRACT>
<purpose>Single-sourced workshop module loader map (RFC-1125) — the canonical list of kernel modules a Werkstatt workshop loads, shared between the reference monorepo and the site-workshop stack profile.</purpose>
<keywords>kernel, module-loaders, workshop, site-workshop, profile, single-source</keywords>
<responsibilities>
  <item>Declares which engine/sitePlugin/forge modules a client-facing workshop loads (WORKSHOP_MODULE_MAP).</item>
  <item>Materializes descriptors into moduleLoaders thunks via workshopModuleLoaders().</item>
</responsibilities>
<non-goals>
  <item>Do not add platform-development validators (werkstatt-shared-validate, werkstatt-commands-validate, werkstatt-e2e, typescript-checks) — they stay repo-local in tools/kernel.config.ts.</item>
  <item>Do not add warpgogol-product modules (portal, billing, warpgogol-lifecycle, projektarchiv-operations) or platform codegen (icons) — they stay repo-local.</item>
  <item>Do not import module specifiers statically — werkstatt-engine does not depend on @warpgogol/werkstatt-site; specs resolve from the consumer's node_modules at runtime.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1125: initial WorkshopModuleMap — descriptors + workshopModuleLoaders() materializer; consumed by tools/kernel.config.ts and the site-workshop profile's scaffolded kernel.config.ts.</item>
  <item>RFC-1140: steps 1-4 — shared resolver, queue module, registration

Extract pipeline-status derivation into packages/forge/src/pipeline-status.ts, refactor rfc.pipeline.status onto it, add os/queue module with queue.validate command, register in WORKSHOP_MODULE_MAP.forge + bin/cli.ts + package.json exports.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

/**
 * Descriptor for one kernel module. `spec` is the npm subpath specifier resolved
 * at runtime from the CONSUMER's node_modules (this repo's root or a client
 * workshop root — both install @warpgogol/* as dependencies). `export` is the
 * named export holding the module: a factory function (`createXModule`) or a
 * module object (`xModule`) — the materializer handles both.
 */
export interface WorkshopModuleDescriptor {
  spec: string;
  export: string;
}

/**
 * Single-sourced module map covering the workshop-facing module subset
 * (RFC-1125). Consumed by this repo's tools/kernel.config.ts AND embedded in
 * the site-workshop profile's scaffolded kernel.config.ts — drift between
 * profile and reference workshop is impossible by construction.
 *
 * Buckets are descriptive only; workshopModuleLoaders() flattens them.
 */
export interface WorkshopModuleMap {
  /** @warpgogol/werkstatt-engine modules — site lifecycle + platform services. */
  engine: Record<string, WorkshopModuleDescriptor>;
  /** @warpgogol/werkstatt-site plugin modules — checks, onboarding, testing. */
  sitePlugin: Record<string, WorkshopModuleDescriptor>;
  /** @warpgogol/forge governance modules — rfc, adr, session, compass, … */
  forge: Record<string, WorkshopModuleDescriptor>;
}

const ENGINE = "@warpgogol/werkstatt-engine";
const SITE = "@warpgogol/werkstatt-site";
const FORGE = "@warpgogol/forge";

const engine = (spec: string, exp: string): WorkshopModuleDescriptor => ({
  spec: `${ENGINE}/${spec}`,
  export: exp,
});
const sitePlugin = (spec: string, exp: string): WorkshopModuleDescriptor => ({
  spec: `${SITE}/${spec}`,
  export: exp,
});
const forge = (spec: string, exp: string): WorkshopModuleDescriptor => ({
  spec: `${FORGE}/${spec}`,
  export: exp,
});

export const WORKSHOP_MODULE_MAP: WorkshopModuleMap = {
  engine: {
    mission: engine("mission-module", "createMissionModule"),
    sternsystem: engine("sternsystem-module", "createSternsystemModule"),
    bordbuch: engine("bordbuch-module", "createBordbuchModule"),
    release: engine("release-module", "createReleaseModule"),
    leitstand: engine("leitstand-module", "createLeitstandModule"),
    notausgang: engine("notausgang-module", "createNotausgangModule"),
    evidence: engine("evidence-module", "createEvidenceModule"),
    identity: engine("identity-module", "createIdentityModule"),
    fleet: engine("fleet-module", "createFleetModule"),
    gitmesh: engine("kernel", "createGitmeshModule"),
    dht: engine("kernel/dht-module", "createDhtModule"),
    swim: engine("kernel/swim-module", "createSwimModule"),
    "artifact-store": engine("artifact-store-module", "createArtifactStoreModule"),
    "behavior-snapshot": engine("behavior-snapshot-module", "createBehaviorSnapshotModule"),
    handoff: engine("handoff-module", "createHandoffModule"),
    platform: engine("platform-module", "createPlatformModule"),
    signing: engine("signing-module", "createSigningModule"),
    nachweis: engine("nachweis-module", "createNachweisModule"),
    sichtpass: engine("sichtpass-module", "createSichtpassModule"),
    subdomain: engine("subdomain-module", "createSubdomainModule"),
    customdomain: engine("customdomain-module", "createCustomdomainModule"),
    dns: engine("dns-module", "createDnsModule"),
    deploy: engine("deploy-module", "createDeployModule"),
    observability: engine("observability/module", "createObservabilityModule"),
    cache: engine("kernel/cache-module", "createCacheModule"),
    "commit-message": engine("kernel/commit-message", "createCommitMessageModule"),
    "pipeline-budget": engine("kernel/pipeline-budget", "createPipelineBudgetModule"),
    "validator-inventory": engine("kernel/validator-inventory", "createValidatorInventoryModule"),
    remediation: engine("remediation-module", "createRemediationModule"),
    "command-manifest": engine("kernel/command-manifest-module", "createCommandManifestModule"),
    "component-runtime": engine("component-runtime-module", "createComponentRuntimeModule"),
    effects: engine("effects-module", "createEffectsModule"),
    evolution: engine("evolution-module", "createEvolutionModule"),
    isolation: engine("isolation-module", "createIsolationModule"),
    scope: engine("scope-module", "createScopeModule"),
    composition: engine("composition-module", "compositionModule"),
    lagebild: engine("lagebild-module", "createLagebildModule"),
    "werkstatt-autonomy": engine("os/werkstatt-autonomy-module", "werkstattAutonomyModule"),
  },
  sitePlugin: {
    check: sitePlugin("checks/module", "createStandardCheckModule"),
    onboarding: sitePlugin("onboarding/module", "createOnboardingModule"),
    testing: sitePlugin("testing/module", "createTestingModule"),
  },
  forge: {
    "forge-core": forge("os/core", "createForgeCoreModule"),
    "forge-compass": forge("os/compass", "forgeCompassModule"),
    "forge-naming": forge("os/naming-module", "createForgeNamingModule"),
    workflow: forge("os/workflow-module", "createForgeWorkflowModule"),
    rfc: forge("os/rfc-module", "createForgeRfcModule"),
    "forge-adr": forge("os/adr-module", "createForgeAdrModule"),
    "forge-plan": forge("os/plan-module", "createForgePlanModule"),
    "forge-audit": forge("os/audit-module", "createForgeAuditModule"),
    "forge-session": forge("os/session-module", "createForgeSessionModule"),
    "forge-mission": forge("os/mission-module", "createForgeMissionModule"),
    "forge-werkstatt": forge("os/werkstatt", "forgeWerkstattModule"),
    "forge-spec": forge("os/spec-module", "createForgeSpecModule"),
    "forge-exploration": forge("os/exploration", "createForgeExplorationModule"),
    "forge-notes": forge("os/notes", "createForgeNotesModule"),
    "forge-program": forge("os/program", "createForgeProgramModule"),
    "forge-plugin": forge("os/plugin", "forgePluginModule"),
    "forge-queue": forge("os/queue-module", "createForgeQueueModule"),
  },
};

/**
 * Materialize WORKSHOP_MODULE_MAP into the `moduleLoaders` record shape that
 * defineKernelConfig expects. Each thunk resolves its specifier lazily via
 * dynamic import — specifiers are resolved from the consumer's node_modules,
 * so this works identically in the reference monorepo and in a scaffolded
 * client workshop.
 */
export function workshopModuleLoaders(): Record<string, () => Promise<ModuleExport>> {
  const loaders: Record<string, () => Promise<ModuleExport>> = {};
  const buckets: Record<string, WorkshopModuleDescriptor>[] = [
    WORKSHOP_MODULE_MAP.engine,
    WORKSHOP_MODULE_MAP.sitePlugin,
    WORKSHOP_MODULE_MAP.forge,
  ];
  for (const bucket of buckets) {
    for (const [key, desc] of Object.entries(bucket)) {
      loaders[key] = async () => {
        const mod = (await import(desc.spec)) as Record<string, unknown>;
        const exported = mod[desc.export];
        if (exported === undefined) {
          throw new Error(
            `[workshopModuleLoaders] '${desc.spec}' has no export '${desc.export}' — check WORKSHOP_MODULE_MAP entry '${key}'`,
          );
        }
        return (typeof exported === "function" ? await exported() : exported) as ModuleExport;
      };
    }
  }
  return loaders;
}
