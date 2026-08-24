/*
<MODULE_CONTRACT>
<purpose>Facilitates the export of core functionalities and types for kernel operations and RFC governance.</purpose>
<non-goals>
  <item>Do not implement the internal logic of kernel commands or RFC processing.</item>
  <item>Do not handle raw content parsing or transport orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Backfills module contract to enhance navigability and maintainability of kernel and RFC exports.</item>
  <item>RFC-0258: export writeFileAtomic — the atomic write primitive for workspace-shared kernel-command outputs.</item>
  <item>RFC-0260: export resolveCommandFlags, KERNEL_UNIVERSAL_FLAGS, and the KernelFlagSpec type.</item>
  <item>RFC-0264 cleanup: delegate complete domains to their subpath barrels and keep the root entrypoint thin.</item>
</CHANGE_SUMMARY>
*/

export * from "./discovery.ts";
export * from "./workspace-discovery.ts";
export {
  resolveSiteWorkspace,
  type SiteWorkspace,
  type SiteWorkspaceSource,
} from "./site-workspace-resolver.ts";
export { createKernelLogger } from "./logger.ts";
export { KernelRegistry } from "./registry.ts";
export * from "./runtime.ts";
export * from "./types.ts";
export { resolveCompassScanRoot } from "./resolve-compass-scan-root.ts";
export { runKernelWire } from "./wire.ts";

// Icons generation domain
export { iconsModule } from "./icons/icons.module.ts";
export { runIconsGenerate } from "./icons/index.ts";

// RFC governance domain — migrated to @warpgogol/forge (RFC-0374, RFC-0391)
export {
  runRfcList,
  runRfcCreate,
  runRfcValidate,
  runRfcCommandLifecycleValidate,
  runRfcCheck,
  runRfcAcceptanceRun,
  runProbe,
  validateAcceptanceShape,
  runRfcVerificationEmit,
  buildEvidenceEnvelope,
  runRfcDnaTraceValidate,
  runRfcDnaTraceGenerate,
  buildDnaTrace,
  collectDecisionLog,
  scoreDecisions,
  runRfcDecisionLogGenerate,
  runRfcSupersedePropose,
  runRfcArchive,
  RFC_STATUSES,
  RFC_KINDS,
  RFC_SCOPES,
  RFC_DIR,
  RFC_TEMPLATE_FILE,
  RFC_ID_PATTERN,
  RFC_FULL_REQUIRED_SECTIONS,
  RFC_METADATA_CUTOFF,
} from "@warpgogol/forge/os/rfc";
export type {
  DnaTraceEntry,
  DnaTraceResult,
  DecisionLogEntry,
  DecisionLogEntryKind,
  DecisionLogResult,
  ConsultedDecision,
  RfcSupersedeProposeResult,
  RfcStatus,
  RfcKind,
  RfcScope,
  RfcCommands,
  RfcFrontmatter,
  RfcListEntry,
  RfcListResult,
  RfcCreateResult,
  RfcValidationViolation,
  RfcValidationResult,
  RfcCommandLifecycleViolation,
  RfcCommandLifecycleValidationResult,
  RfcCheckViolation,
  RfcCheckResult,
  AcceptanceProbe,
  ProbeResult,
  RfcAcceptanceRunResult,
  VerificationEvidence,
  VerificationEvidenceProbeRecord,
  RfcVerificationEmitResult,
  RfcArchiveResult,
  RfcArchiveMove,
  RfcArchiveSkip,
} from "@warpgogol/forge/os/rfc";

// ADR governance domain (RFC-0366)
export * from "./adr/index.ts";

// Compass inventory scanning (shared with site-kernel-codegen to avoid circular dep)
export { createCompassInventoryEntries, type CompassInventoryEntry } from "./compass-inventory.ts";

// RFC-0258: atomic file-write primitive for workspace-shared writers
export { writeFileAtomic, type WriteFileAtomicOptions } from "./fs-atomic.ts";

// RFC-0345: idempotent file-write primitive — skips writes when content is unchanged
export { writeFileIfChanged } from "./fs-idempotent.ts";

// RFC-0267: WorkspaceIO port + adapters
export * from "./workspace-io.ts";

// RFC-0081: Generated-file governance marker (canonical source lives in site-kernel)
// RFC-0336: buildGeneratedHeader is the single shared advisory-block builder.
export {
  GENERATED_MARKER,
  hasGeneratedMarker,
  stripGeneratedMarker,
  isGeneratedMarkerTextCandidate,
  buildGeneratedHeader,
  type StripGeneratedMarkerResult,
  type GeneratedHeaderInput,
} from "./generated-marker.ts";

// RFC-0042: Semantic layer validation domain
export { semanticModule } from "./semantic/semantic.module.ts";
export { runSemanticPageValidate } from "./semantic/handlers.ts";

// RFC-0075: Agent workflow discovery and linting domain — workflowModule migrated to @warpgogol/forge (RFC-0374)
export { runWorkflowLint, runWorkflowList, runWorkflowAmendList } from "./workflow/index.ts";
export type {
  WorkflowPhase,
  WorkflowChain,
  WorkflowPreconditions,
  WorkflowBranch,
  WorkflowFrontmatter,
  WorkflowListEntry,
  WorkflowLintViolation,
  WorkflowLintResult,
} from "./workflow/index.ts";

// RFC-0186: Lagebild shared sync worker domain
export * from "./lagebild/index.ts";

// RFC-0265: commit message hygiene lint
export { commitMessageModule } from "./commit-message.module.ts";
export {
  runCommitMessageLint,
  lintCommitSubject,
  parseGitLogOutput,
  parseNameOnlyOutput,
  isExempt,
} from "./commit-message-lint.ts";
export type { CommitRecord, CommitMessageFinding } from "./commit-message-lint.ts";

// RFC-0270: pipeline timing budgets derived from telemetry
export { pipelineBudgetModule } from "./pipeline-budget.module.ts";
// RFC-0332: change impact classifier and advisory check profiles
export { changeImpactModule } from "./change-impact.module.ts";
export * from "./change-impact.ts";
export * from "./pipeline-budgets.ts";

// RFC-0266: single command manifest — generator core + generate command
export { commandManifestModule } from "./command-manifest.module.ts";
export * from "./command-manifest.ts";

// RFC-0563: Git-mesh platform code replication
export { gitmeshModule } from "./gitmesh/gitmesh-module.ts";
export type {
  GitMeshConfig,
  GitMeshRemote,
  GitMeshSyncResult,
  GitMeshStatus,
  GitMeshVerifyResult,
} from "./gitmesh/types.ts";

// ADR-0015: Shared utilities extracted from site-kernel-handoff to break cyclic dependency
export {
  parseSemver,
  compareSemver,
  ltSemver,
  gtSemver,
  eqSemver,
  inOpenClosedRange,
} from "./semver.ts";
export {
  PLATFORM_SCOPE_PREFIXES,
  isPlatformScope,
  hasPlatformScopeFiles,
  extractTrailer,
  hasTrailer,
} from "./platform-scope.ts";
export { resolveMissionDir } from "./mission-resolver.ts";
export { resolvePlatformSemanticHash } from "./platform-hash.ts";

// RFC-0564: SWIM membership and CRDT genome
export { swimModule } from "./swim/swim-module.ts";
export type {
  SwimMember,
  SwimMemberStatus,
  SwimConfig,
  SwimMembershipView,
  GenomeLogEntry,
} from "./swim/types.ts";
