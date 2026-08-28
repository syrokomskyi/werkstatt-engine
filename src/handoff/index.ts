/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/index.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not materialize handoff.absorb writes until the guarded RFC-0221 follow-up lands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: add package entrypoint and command module for the first read-only handoff commands.</item>
  <item>RFC-0221: register thin handoff.pack and report-gated handoff.absorb handlers.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";
import { runHandoffAbsorb } from "./handoff-absorb.ts";
import { runHandoffPack } from "./handoff-pack.ts";
import { runHandoffValidate } from "./handoff-validate.ts";
import { runMigratorRegistryValidate } from "./migrator-registry-validate.ts";

export { diffCapabilities, intentMatches, worstTier } from "./capability-diff.ts";
export {
  hashFile,
  readLock,
  readManifest,
  readRegistryView,
  resolveCurrentEcosystem,
  resolvePlatformSemanticHash,
  sha256OfBytes,
  type CurrentEcosystem,
} from "./bundle-io.ts";
export { runHandoffValidate, type HandoffValidateData } from "./handoff-validate.ts";
export { runHandoffPack, type HandoffPackData } from "./handoff-pack.ts";
export { runHandoffAbsorb, type HandoffAbsorbData } from "./handoff-absorb.ts";
export { buildCatchupReport, type BuildReportInput } from "./absorb-report.ts";
export {
  runMigratorRegistryValidate,
  type MigratorRegistryValidateData,
} from "./migrator-registry-validate.ts";
export {
  migratorRegistry,
  migratorsToApply,
  numericRfcId,
  allMigratorIds,
} from "../migrators/registry.ts";
export type {
  Migrator as NewMigrator,
  SternsystemData,
  MigrationContext,
  MigrationViolation,
} from "../migrators/types.ts";
export { MigrationError } from "../migrators/types.ts";
export {
  compareSemver,
  eqSemver,
  gtSemver,
  inOpenClosedRange,
  ltSemver,
  parseSemver,
} from "./semver.ts";
export type {
  AuthoredSet,
  CapabilityChange,
  CapabilityDiffItem,
  CatchupReport,
  CatchupTier,
  HandoffCapability,
  RegistryView,
  VersionComparison,
  VersionVerdict,
} from "./types.ts";
export { compareEcosystem, type CompareEcosystemInput } from "./version-compare.ts";
export type { GuardResult, GuardVerdict, GuardViolation } from "./guards.ts";
export {
  PLATFORM_SCOPE_PREFIXES,
  isPlatformScope,
  hasPlatformScopeFiles,
  extractTrailer,
  hasTrailer,
} from "./platform-scope.ts";

export {
  createSternsystemModule,
  runSternsystemRegister,
  runSternsystemList,
  runSternsystemValidate,
  runSternsystemPin,
  type SternsystemRegisterData,
  type SternsystemListData,
  type SternsystemValidateData,
  type SternsystemPinData,
} from "../sternsystem/index.ts";

// createWerkstattModule migrated to @warpgogol/forge — see packages/forge/os/werkstatt/
export {
  runWerkstattLockStatus,
  type WerkstattLockStatusData,
  runWerkstattLockRecover,
  type WerkstattLockRecoverData,
  acquireLock,
  releaseLock,
  heartbeatLock,
  readAllLocks,
  isLockStale,
  startOperation,
  completeOperation,
  failOperation,
  readOperation,
  computeInputHash,
  generateOperationId,
  atomicWriteFile,
  atomicMoveDir,
  resolveStagingDir,
} from "../werkstatt/index.ts";

export { createMissionModule } from "../mission/mission.module.ts";
export {
  runWorkpieceRead,
  runWorkpieceWrite,
  isClientEditable,
  type WorkpieceReadResult,
  type WorkpieceWriteResult,
} from "../workpiece/index.ts";
export { createBordbuchModule } from "../bordbuch/index.ts";
export { createNachweisModule } from "../nachweis/index.ts";
export {
  appendBordbuchEntry,
  readBordbuch,
  runBordbuchGenerate,
  runBordbuchStatus,
  type BordbuchViolation,
} from "../bordbuch/index.ts";
export { createArtifactStoreModule } from "../artifact-store/index.ts";
export { createBehaviorSnapshotModule } from "../behavior-snapshot/index.ts";
export { createReleaseModule } from "../release/index.ts";
export { createLeitstandModule } from "../leitstand/index.ts";
export { createSubdomainModule } from "../subdomain/index.ts";
export { createCustomdomainModule } from "../customdomain/index.ts";
export { createDnsModule } from "../dns/index.ts";
export { createNotausgangModule } from "../notausgang/index.ts";
export { createDeployModule } from "../deploy/index.ts";
export { createEvidenceModule } from "../evidence/index.ts";
export { createPlatformModule } from "./platform-module.ts";
export {
  runPlatformConsistencyValidate,
  type PlatformConsistencyData,
  type PlatformConsistencyViolation,
} from "./platform-consistency.ts";

/** RFC-0221/RFC-0479 command module: validate, migrator.registry.validate, pack, and version-aware absorb (materializes; --report-only/--as/--regen/--force). */
export function createHandoffModule(): KernelModule {
  return {
    name: "handoff",
    version: "0.2.0",
    register(registry) {
      registry.registerCommand({
        name: "handoff.validate",
        contract: "handoff",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/handoff/index.ts",
        description:
          "Validate an internal site handoff bundle lock, manifest, and file hashes without absorbing it (RFC-0221).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          bundle: { kind: "string", description: "Path to the handoff bundle directory." },
        },
        execute: runHandoffValidate,
      });
      registry.registerCommand({
        name: "migrator.registry.validate",
        contract: "migrator",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/handoff/index.ts",
        description:
          "Validate the RFC-0479 migrator registry (id uniqueness, ordering, test coverage).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {},
        execute: runMigratorRegistryValidate,
      });
      registry.registerCommand({
        name: "handoff.pack",
        modulePath: "packages/werkstatt-engine/src/handoff/index.ts",
        generates: [],
        description:
          "Pack a thin, version-stamped internal handoff bundle: `handoff.pack --site <app>` (RFC-0221).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          site: { kind: "string", required: true, description: "App name to pack." },
        },
        writes: ["../handoff/{site}/**"],
        execute: runHandoffPack,
      });
      registry.registerCommand({
        name: "handoff.absorb",
        modulePath: "packages/werkstatt-engine/src/handoff/index.ts",
        generates: [],
        description:
          "Ingest a handoff bundle: report (version compare + capability diff), refuse downgrades, then materialize (inject authored + delegate regen). Flags: --report-only, --as <name>, --regen, --force (RFC-0221).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          bundle: { kind: "string", description: "Path to the handoff bundle directory." },
          "report-only": {
            kind: "boolean",
            description: "Only print the catch-up report; do not materialize files.",
          },
          regen: { kind: "boolean", description: "Run delegated regeneration after absorb." },
          as: { kind: "string", description: "Absorb into this target app name." },
        },
        writes: ["apps/{targetApp}/**"],
        execute: runHandoffAbsorb,
      });
    },
  };
}
