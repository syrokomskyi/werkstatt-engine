# `@warpgogol/werkstatt-engine` — Agent Guide

RFC-0769/0772: Werkstatt engine — stack-agnostic lifecycle platform. Consolidated from `packages/os/site-kernel`, `packages/os/site-kernel-handoff`, `packages/os/site-kernel-integrity`, `packages/os/site-kernel-observability`, `packages/os/site-kernel-changelog`, `packages/fingerprint`, `packages/agent-gate`, and `packages/ontology/operations` into a single engine package.

**Workspace type:** Package

This is a **package** workspace. Expose stable typed APIs. Do not import from apps or services.

## Entry points

| Entry point | Module |
| --- | --- |
| `@warpgogol/werkstatt-engine` | `./src/index.ts` |
| `@warpgogol/werkstatt-engine/os/werkstatt-autonomy-module` | `./os/werkstatt-autonomy.module.ts` |
| `@warpgogol/werkstatt-engine/kernel` | `./src/kernel/index.ts` |
| `@warpgogol/werkstatt-engine/kernel/*` | `./src/kernel/*` (all kernel subpath exports) |
| `@warpgogol/werkstatt-engine/mission` | `./src/mission/index.ts` |
| `@warpgogol/werkstatt-engine/sternsystem` | `./src/sternsystem/index.ts` |
| `@warpgogol/werkstatt-engine/release` | `./src/release/index.ts` |
| `@warpgogol/werkstatt-engine/leitstand` | `./src/leitstand/index.ts` |
| `@warpgogol/werkstatt-engine/fleet` | `./src/fleet/index.ts` |
| `@warpgogol/werkstatt-engine/fleet-module` | `./src/fleet/fleet.module.ts` |
| `@warpgogol/werkstatt-engine/bordbuch` | `./src/bordbuch/index.ts` |
| `@warpgogol/werkstatt-engine/notausgang` | `./src/notausgang/index.ts` |
| `@warpgogol/werkstatt-engine/artifact-store` | `./src/artifact-store/index.ts` |
| `@warpgogol/werkstatt-engine/evidence` | `./src/evidence/index.ts` |
| `@warpgogol/werkstatt-engine/integrity` | `./src/integrity/index.ts` |
| `@warpgogol/werkstatt-engine/signing` | `./src/signing/index.ts` |
| `@warpgogol/werkstatt-engine/observability` | `./src/observability/index.ts` |
| `@warpgogol/werkstatt-engine/fingerprint` | `./src/fingerprint/index.ts` |
| `@warpgogol/werkstatt-engine/fingerprint/semantic` | `./src/fingerprint/semantic.ts` |
| `@warpgogol/werkstatt-engine/agent-gate` | `./src/agent-gate/index.ts` |
| `@warpgogol/werkstatt-engine/agent-gate/reflect-route` | `./src/agent-gate/reflect-route.ts` |
| `@warpgogol/werkstatt-engine/component-runtime-module` | `./src/component-runtime/component-runtime.module.ts` |
| `@warpgogol/werkstatt-engine/isolation-module` | `./src/isolation/isolation.module.ts` |
| `@warpgogol/werkstatt-engine/changelog` | `./src/changelog/index.ts` |
| `@warpgogol/werkstatt-engine/schemas` | `./src/schemas/index.ts` |
| `@warpgogol/werkstatt-engine/component` | `./src/component/index.ts` |
| `@warpgogol/werkstatt-engine/handoff` | `./src/handoff/index.ts` |
| `@warpgogol/werkstatt-engine/e2e` | `./src/e2e/index.ts` |
| `@warpgogol/werkstatt-engine/os/werkstatt-e2e-module` | `./os/werkstatt-e2e-module.ts` |
| `@warpgogol/werkstatt-engine/*-module` | `./src/*/*.module.ts` (all module entry points) |

## Command registration discipline

- **Kernel commands MUST be registered in `*.module.ts` files, not in `index.ts` barrels.** The kernel loads modules via the `*-module` subpath export (e.g. `@warpgogol/werkstatt-engine/sternsystem-module` resolves to `sternsystem.module.ts`). A `createSternsystemModule` (or any `create*Module`) function in an `index.ts` barrel is dead code — the runtime never calls it. Commands registered there are invisible to `command.manifest.generate` and cause `RFC-CMD-02` validation errors. Discovered during RFC-0968: handover commands were added to `sternsystem/index.ts` instead of `sternsystem.module.ts`, making them invisible to the manifest generator.
- **Before registering a new kernel command, grep for existing registrations across ALL packages.** The kernel registry rejects duplicate command names across modules with a fatal "Kernel command already registered" error that blocks ALL commands from loading. Commands like `mission.archive` are registered in `packages/forge/os/mission/mission.module.ts` — adding a second registration in `packages/werkstatt-engine/src/mission/mission.module.ts` crashes the entire kernel. Always run `grep -r 'name: "commandName"' packages/*/src/**/*.module.ts packages/*/os/**/*.module.ts` before adding a new `registry.registerCommand` call.

## Kernel module lifecycle (RFC-1026)

- `KernelRegistry` implements `KernelLifecycleRegistry` with `unregisterModule`, `trackInFlight`, `getModuleState` for lifecycle-owned registrations.
- `ModuleFiberState`: `declared` → `loading` → `active` → `draining` → `unloading` → `disposed` (or `failed` on registration error).
- `buildRegistry` and `buildRegistryForModule` set module states during loading; rollback on `register()` failure removes all commands and pipelines owned by the failed module.
- `buildRegistryWithHandles` returns a `Map<string, KernelModuleHandle>` alongside the registry — each handle exposes `dispose()` and live `state`.
- `unregisterModule` drains in-flight commands (polling with `WERKSTATT_DRAIN_TIMEOUT_MS`, default 30s), then removes all commands/pipelines and sets state to `disposed`. Records disposed command origins in `disposedCommandOrigins` for `KERNEL-MODULE-01` error reporting.
- `trackInFlight(commandName)` returns a release function — must be called in `finally` to ensure the count is decremented on failure or timeout.
- `executeRegisteredCommand` checks module state before execution: rejects with `KERNEL-MODULE-02` if the owning module is not `active`.
- `executeKernelCommand` checks `disposedCommandOrigins` when a command is not found: reports `KERNEL-MODULE-01` if the command was previously registered but its module was unloaded.
- `clearModule(cacheKey, moduleName)` in `registry-cache.ts` incrementally invalidates a single module from a cached registry without clearing the entire cache. Removes the cache entry when no active modules remain.
- `kernel-module.module.ts` registers `kernel.module.inspect`, `kernel.module.unload`, `kernel.module.load` commands for runtime lifecycle management.
- Tests: `src/kernel/tests/module-lifecycle.test.ts` covers states, unregister, drain, rollback, cache invalidation, trackInFlight.

## Evolution controller (RFC-1031)

- `evolution.module.ts` registers 9 `evolution.candidate.*` commands for agent-driven component candidate lifecycle:
  - `evolution.candidate.define` — register immutable candidate from content-addressed artifact
  - `evolution.candidate.shadow` — parallel execution alongside active component with comparison metric
  - `evolution.candidate.test` — run held-out evaluation scenarios
  - `evolution.candidate.canary` — route a subset of traffic to candidate (deterministic hash-based)
  - `evolution.candidate.activate` — atomically replace active component with candidate
  - `evolution.candidate.promote` — persist activation through mission/release pipeline
  - `evolution.candidate.rollback` — revert to previous component
  - `evolution.candidate.quarantine` — deactivate candidate due to health failure
  - `evolution.candidate.inspect` — return all candidates with lifecycle state
- Lifecycle stages: `defined → shadowing → testing → canary → activating → active → promoted` with `rolled-back` and `quarantined` as terminal exits.
- `shadow-executor.ts` runs candidate and active functions in parallel, records `CandidateEvidenceV1` with delta metric.
- `canary-router.ts` uses deterministic `Sha256Digest` of canonical JSON input for routing decisions.
- `health-monitor.ts` tracks consecutive failures; quarantine threshold defaults to 3.
- Agent-written candidates require `--allow-agent-written` flag on `evolution.candidate.define`.
- Tests: `src/tests/evolution-controller.test.ts` covers contracts, reducer, guards, controller, shadow executor, canary router, health monitor.

## Isolation controller (RFC-1035)

- `isolation.module.ts` registers 6 `isolation.*` commands for component isolation and sandboxing tiers:
  - `isolation.tier.inspect` — inspect the isolation tier of registered components
  - `isolation.tier.assign` — assign an isolation tier to a component (Tier 0 requires human approval)
  - `isolation.sandbox.spawn` — spawn a sandbox at a specified tier with policy (fs paths, network, commands, limits)
  - `isolation.sandbox.inspect` — inspect sandbox health, resource usage, and state
  - `isolation.sandbox.terminate` — terminate a sandbox and release resources
  - `isolation.capability.bridge` — create a capability bridge for policy-enforced host-sandbox communication
- `IsolationTier` is a numeric union (0 = in-process, 1 = worker thread, 2 = subprocess, 3 = WASM), replacing the legacy binary string union.
- `IsolationManager` (`isolation-manager.ts`): manages sandbox lifecycle (spawn, inspect, terminate, list) and tier assignments. Enforces ISOLATION-04 (max sandboxes), ISOLATION-06 (Tier 0 human approval), ISOLATION-07 (no admitted provider), ISOLATION-08 (sensitive path deny-list).
- `CapabilityBridge` (`capability-bridge.ts`): client-side proxy extending `CapabilityBrokerV1` with policy enforcement. Tracks violations (3 within 60s triggers auto-terminate). Enforces ISOLATION-01 (command not granted) and ISOLATION-02 (timeout).
- Bordbuch entry kind `"isolation"` records sandbox lifecycle events (spawn, terminate, crash) with sandboxId, tier, componentId, action metadata.
- Tests: `src/isolation/tests/isolation-manager.test.ts` covers AC-1 through AC-11 plus edge cases (24 tests).

## Runtime reflection (RFC-1030)

- `component-runtime.module.ts` registers 5 `runtime.reflect.*` commands for live runtime introspection:
  - `runtime.reflect.graph` — full `RuntimeReflectionV1` (components, dependency edges, law kernel summary)
  - `runtime.reflect.capabilities` — `CapabilityCatalogV1` (reuses `createCapabilityCatalog` from RFC-1029)
  - `runtime.reflect.health` — health check results for all components (parallel, 5s per-component, 10s global batch timeout)
  - `runtime.reflect.fibers` — lightweight `{ componentId, fiberState }[]` view
  - `runtime.reflect.catalog.generate` — writes `docs/runtime-catalog.generated.yaml` (gitignored)
- `reflectRuntime()` in `src/component-runtime/reflection.ts` is a pure function: takes `ReflectionInput` + `LawKernelSummary`, returns `RuntimeReflectionV1`. Skips disposed components (increments `skippedDisposed`). No kernel types — callable from any package.
- `createAgentReflectRoute()` in `src/agent-gate/reflect-route.ts` is an Astro API route factory. Returns `{ GET, OPTIONS }`. GET calls `reflectRuntime()` and returns JSON. Rate limited: 10 req/min per IP via `createFixedWindowLimiter` (in-memory, per-isolate soft limit). ACCESS_PIN middleware respected at the Astro middleware layer.
- `command.manifest.generate` includes optional `runtimeState` section (reflectedAt, resolvedComponentSetHash, catalogHash) when a live component runtime is available. In build-time context, `runtimeState` is omitted.

## Scripts

| Script        | Command                                       |
| ------------- | --------------------------------------------- |
| `lint`        | `pnpm exec eslint "src/**/*.ts" "os/**/*.ts"` |
| `typecheck`   | `pnpm exec tsc -p tsconfig.json --noEmit`     |
| `build`       | `pnpm exec tsc -p tsconfig.json --noEmit`     |
| `build:check` | `pnpm exec tsc -p tsconfig.json --noEmit`     |
| `test`        | `vitest run`                                  |
| `test:watch`  | `vitest`                                      |

## ESLint config

- **The package-level `eslint.config.js` MUST include a test file override** matching the root config pattern: `files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"]` with `@typescript-eslint/no-explicit-any: "off"` and `local-rules/no-as-any: "off"`. Without this override, test mocks using `as any` for partial implementations of complex interfaces fail with `local-rules/no-as-any`. The root `eslint.config.js` has this override at line 248, but the engine package has its own `eslint.config.js` that does not inherit from root — the override must be duplicated locally.

## Package architecture

- This package owns the Werkstatt engine: kernel runtime, missions, mirrors (Sternsystem), releases, Leitstand, Bordbuch, Notausgang, artifact store, evidence, deploy orchestration, werkstatt consistency primitives, fingerprint, integrity, observability, agent-gate, changelog, and operations schemas.
- The package is stack-agnostic (DNA-64). It MUST NOT import stack plugins.
- The legacy `werkstatt/plugin@1` contract, registry, and invoke-hook were removed by RFC-0942. The engine now uses `forge` profile-selected capabilities; no stack plugin contract remains in `@warpgogol/werkstatt-engine`.
- The `werkstatt.autonomy.validate` command (DNA-64 enforcement) scans `src/**` for forbidden `@warpgogol/*` static imports. The `werkstatt.shared.validate` command (RFC-0868) enforces that no `@warpgogol/werkstatt-site/*` static imports remain in `src/**`.
- **Dynamic `import()` for stack-specific code**: When the engine needs to call stack-specific functions from a plugin (e.g. `werkstatt-site/codegen`, `werkstatt-site/onboarding`, `werkstatt-site/checks`), use dynamic `import()` at the call site, not static `import ... from`. The autonomy and shared guards scan only static import statements — dynamic `import()` is the sanctioned escape hatch for genuinely stack-specific runtime calls, same pattern used by `moduleLoaders` and `deployAdapters` in the plugin contract. Example: `const { runContentRefIndexGenerate } = await import("@warpgogol/werkstatt-site/codegen");`
- **Stub methods MUST throw `NOT_IMPLEMENTED`, never silently return empty values.** A method that returns `[]` or `void` without performing its described function is a silent no-op — callers cannot distinguish "nothing to do" from "not implemented". Throw `new Error("NOT_IMPLEMENTED: <method> — <what is missing>")` instead. This prevents silent failures where a command succeeds but does nothing. Discovered during RFC-1031: `controller.test()` returned `[]` and `controller.promote()` set stage without creating a mission — both were silent stubs.
- RFC-0776 completed the migration: old packages (`packages/os/site-kernel*`, `packages/fingerprint`, `packages/agent-gate`) are deleted. All imports now go through `@warpgogol/werkstatt-engine` subpath exports.

### Operation journal (RFC-0958)

- `src/journal/` owns the JSONL-based operation journal: `jsonl.ts` (append/read/findIncompleteOperation), `runner.ts` (runOperation, abandonOperation), `check-blocking.ts` (different-kind operation blocking), `types.ts` (JournalRecord, OperationStep, OperationDefinition, RunOperationResult).
- `src/mission/steps/` owns step definition modules for each lifecycle command: `close-steps.ts`, `open-steps.ts`, `abort-steps.ts`, `materialize-steps.ts`, `validate-steps.ts`, `reconcile-steps.ts`, `archive-steps.ts` (stub). Each delegates to the corresponding `build*Steps` function in the mission command module. `index.ts` provides `resolveOperationSteps` for `mission.resume`.
- All lifecycle commands (`mission.open`, `mission.close`, `mission.abort`, `mission.materialize`, `mission.validate`, `mission.reconcile`) use `runOperation` with a journal at `missions/<missionId>/journal.jsonl` for crash-safe resumable execution.
- `mission.resume` reads the journal, resolves steps via `resolveOperationSteps`, and calls `runOperation` with `resumeOpId` to skip completed steps.
- Different-kind operation blocking: before calling `runOperation`, each lifecycle command calls `checkDifferentKindOperation` to block if a different-kind operation is incomplete.
- `mission.preflight` (RFC-0971) runs `ownership.sync.validate` and `generated.stale.validate` against the cache clone before mission open. Read-only per K-0004. Dispatches via `executeRegisteredCommand` with a custom `site.directory` pointing to the cache clone path.
- RFC-1025: `resolveSiteWorkspace` in `src/kernel/site-workspace-resolver.ts` resolves cache clones (`../systems-cache/<id>/`) as fallback when no active mission and no `apps/<id>/` exist. Resolution priority: mission workpiece > cache clone > apps/. Cache clone resolution is for read-only commands — write commands must go through mission workpieces. The pre-commit hook (RFC-0658) and AGENTS.md soft guard enforce write safety.
- RFC-0991: `behavior-snapshot-refresh` step in `mission.close` auto-generates and commits `behavior.snapshot.generated.yaml` during close. Positioned after `auto-commit-workpiece` (step 2), before `zero-commit-guard` (step 3). Non-fatal — logs warning on failure. Skipped via `--skip-behavior-snapshot` flag.
- **Any `mission.close` step that auto-commits to the workpiece MUST update `workpieceHeadAtReconcile` in `reconciliation-report.json` after commit.** The `reconcile-freshness-check` step (RFC-0913) compares workpiece HEAD against `workpieceHeadAtReconcile` — if an auto-committing step creates a commit but does not update the report, the freshness check fails with a false `unreconciled-commit` error. Use the shared `updateReconcileReportHead(evidenceDir, commitSha)` helper. Discovered during RFC-0992: `behavior-snapshot-refresh` committed the snapshot but did not update the report, causing the freshness gate to block close.
- RFC-1028: incremental mission validation with persistent cache. `moduleBasePath` on `KernelRegisteredCommandInfo` is derived from `command.modulePath` (RFC-0960) in `commandInfo()` for dynamic `moduleSrcDir` resolution in the pipeline executor. `buildCommandResultCacheKey` uses a composite string (`schemaVersion:commandName:siteName:inputsHash:moduleHash`) instead of `stableJsonHash` — enables SQL LIKE filtering by `commandName` in `CacheLayer.list()`. `validation.state.inspect` command (read-only) reads `.validation-state.json` and the SQLite cache. `.validation-state.json` is gitignored at `missions/<missionId>/.validation-state.json`. `mission.validate --force` bypasses the cache; agents MUST NOT delete `.validation-state.json`.

### Agent Gate (RFC-0286, RFC-0954)

- `packages/werkstatt-engine/src/agent-gate/astro.ts` owns the Astro API route factories for the agent surface: `createAgentMcpRoute` (MCP endpoint), `createAgentActionRoute` (action dispatch), and `createAgentSearchRoute` (semantic search).
- `createAgentSearchRoute(manifest)` (RFC-0954) returns `{ GET, POST, OPTIONS }` — handles search queries (GET/POST) and reindex (POST with `x-search-reindex-token` header). Uses `env.AI.run("@cf/baai/bge-m3", ...)` for embeddings and `env.SEARCH_INDEX` (Vectorize) for vector storage. Returns 503 if bindings missing, 502 if embedding fails, 500 if Vectorize query fails. Respects `ACCESS_PIN` middleware for access-protected channels.

### Canonical JSON identity bytes (RFC-0849)

- `snapshotCanonicalJsonObjectV1` is the only creator of runtime-branded `CanonicalJsonObjectV1`. The snapshot takes an object-root input only — root scalars, arrays, and all forbidden descriptors/values return bounded typed failures without logging or partial output.
- The canonical encoder follows strict RFC 8785 JCS (JSON Canonicalization Scheme): no insignificant whitespace, lexicographic key ordering by UTF-16 code unit, mandatory escaping, shortest number representation. The Werkstatt profile additionally rejects negative zero, unsafe integers, lone surrogates, bigint, undefined, functions, symbols, host objects (Date, Map, Set, RegExp, Error, typed arrays), toJSON customization, non-enumerable properties, accessors, symbol keys, sparse array holes, array extra own keys, cycles, and aliases.
- `canonicalJsonBytesV1` and `canonicalJsonHashV1` operate on the opaque branded snapshot only. Forged casts, structural lookalikes, and Proxy wrappers fail with `CERT-CANONICAL-BRAND-01`. The canonical source imports `byteHash` from `primitives.ts` but never `stableJsonHash` or `node:crypto`.
- Hard limits: 8 MiB output bytes, 64 depth, 250k nodes, 10k object keys, 100k array items, 1 MiB string bytes, 1 KiB key bytes. All limits report `actual = maximum + 1` in `CERT-CANONICAL-LIMIT-01` failures.
- Failure paths use only array indices and object sorted ordinals — never raw keys. Path segments are capped at 64; overflow increments `omittedPathSegments`.
- `Sha256Digest` is an opaque branded type (`sha256:` + 64 lowercase hex). `isSha256Digest` is the exact guard. `byteHash` and `byteHashFile` return `Sha256Digest`; existing string consumers remain compatible.

### Canonical Diagnostic schema (RFC-0852)

- `packages/werkstatt/src/schemas/diagnostic.ts` is the **sole owner** of `DiagnosticSeverity`, `DiagnosticEvidence`, and `Diagnostic` strict Zod schemas and inferred types. `kernel/types.ts` re-exports these types (type-only); no duplicate interface, severity union, or schema implementation may exist elsewhere.
- The site plugin (`@warpgogol/werkstatt-site`) imports diagnostic schemas from `@warpgogol/werkstatt-engine/schemas`. Legacy aliases (`auditSeveritySchema`, `auditEvidenceSchema`, `auditFindingSchema`, `AuditFinding`) and deprecated fields (`id`, `blockId`, `suggestion`) are removed; no compatibility alias or parser may be reintroduced.
- `data` accepts only runtime-branded `CanonicalJsonObjectV1` (RFC-0849) validated via `z.custom` + `isCanonicalJsonObjectV1`; arbitrary objects and every RFC-0849-invalid value fail before persistence.
- Field/collection limits: `ruleId` 128 chars `[A-Z0-9][A-Z0-9._-]*`, `message` 4 KiB, `fixHint` 8 KiB, `file`/`ruleFile` 1 KiB, `url` 4 KiB, `snippet` 16 KiB, 32 evidence items, 64 KiB canonical `data` bytes, 128 KiB per Diagnostic, 1000 diagnostics per persisted result.
- Safe locator rules: `file`/`ruleFile` use workspace-relative POSIX paths (reject absolute, backslashes, `..`, empty, URI schemes, home expansion, credentials). URLs must be absolute `http:`/`https:` with no userinfo or credential-bearing query values.
- Redaction: diagnostic strings and canonical `data` must be redacted before construction. Known secret patterns (API keys, JWTs, private keys, bearer tokens, connection strings, AWS creds), absolute paths, and PII (email, phone) are hard failures (`CERT-DIAGNOSTIC-REDACTION-01`).

### Certification foundation integration (RFC-0848)

- The integration suite at `packages/werkstatt/src/tests/certification-foundation.integration.test.ts` proves ten `CERT-INTEGRATION-*` laws using public child APIs only (RFC-0849, 0850, 0851, 0852, 0853).
- No child logic is reimplemented in the integration suite; failures route to the owning child RFC for correction.
- The suite verifies: canonical JSON snapshotting of diagnostic/certification values, identity digest determinism, immutable evaluation cut, permutation invariance, dossier root sensitivity, fail > stale > incomplete > pass precedence, deployment/artifact separation, legacy state rejection, transition block fail-closed, and engine/plugin Diagnostic ownership boundary.
- `@warpgogol/werkstatt-engine` imports no stack plugin; the site plugin defines no duplicate Diagnostic/certification authority.

### Resolved certification profile (CERT-002, packet 140)

- `packages/werkstatt/src/certification/profile/` owns `CertificationProfileV1` strict Zod schemas, producer declarations, requirements, applicability rules, reuse/freshness, execution, remediation, retention, and evaluator policy.
- `hashCertificationProfileV1` computes canonical hash via RFC-0849 fingerprint authority (`snapshotCanonicalJsonObjectV1` + `canonicalJsonHashV1`). The hash is key-order invariant and sensitive to every semantic field change.
- `validateCertificationProfileV1` validates: plugin/profile binding against active plugin and `forge.yaml`, duplicate requirement/producer IDs, producer registration and command existence, nine-dimension Main gate coverage, continuous-health freshness TTL/schedule, rollback drift-action eligibility, and evaluator policy consistency.
- No producer execution, deployment decisions, I/O, clock, env, or plugin imports exist in this module.

### Authority and durable storage (CERT-003, packet 150)

- `packages/werkstatt/src/certification/authority/` owns the issuer registry with idempotent add, conflicting-key rejection (`CERT-AUTHORITY-01`), attestation verification (`CERT-AUTHORITY-02`/`CERT-AUTHORITY-03`), and signed decision/root verification against registered issuers.
- `packages/werkstatt/src/certification/storage/` owns the content-addressed dossier repository with append-only event chain, `previousEventHash` chain validation (`CERT-DOSSIER-01`/`CERT-DOSSIER-02`), root hash recomputation via RFC-0849, chain-break detection (`CERT-DOSSIER-04`), and root reference building.
- The storage adapter interface is provider-neutral: `putObject`, `headObject`, `getObject`, `appendAuditRecord`. An in-memory adapter is provided for testing. An R2 durable storage adapter (`packages/werkstatt/src/certification/storage/r2-adapter.ts`) is implemented for Cloudflare R2 (RFC-0865). `verifyStoredObject` checks existence and size (`CERT-STORAGE-01`/`CERT-STORAGE-02`).
- Retention GC checks protected references (`current`, `rollback-target`, `open-incident`, `audit-hold`), age thresholds (certified vs unsuccessful), and creates tombstones before deletion. Durable replica verification rejects root hash mismatch (`CERT-STORAGE-03`).
- No producer orchestration, deployment commands, or I/O imports exist in this module.

### Certification orchestration and command surface (CERT-004, packet 160)

- `packages/werkstatt/src/certification/orchestration/` owns producer dependency planning via topological sort with cycle detection (`CERT-ORCHESTRATOR-01` duplicate IDs, `CERT-ORCHESTRATOR-02` unknown deps/cycles), gate lock manager with per-release+gate mutual exclusion and idempotent re-acquire (`CERT-ORCHESTRATOR-03` concurrent rejection), producer execution with bounded parallelism (semaphore), timeout, retry with backoff, progress events (`CERT-ORCHESTRATOR-04` execution failure), and resume point computation from partial evidence (`CERT-ORCHESTRATOR-07` all-complete rejection).
- `packages/werkstatt/src/certification/commands/` owns read-only `getCertificationStatus` (candidate identity, latest decisions, coverage, durable replica status, next required action, action-pack locators) and `verifyCertification` (candidate ID recompute, dossier integrity, root hash match, decision references). `CERT-ORCHESTRATOR-08`/`CERT-ORCHESTRATOR-09`/`CERT-ORCHESTRATOR-10` cover identity and integrity failures.
- No producer implementations, deployment commands, or I/O imports exist in this module.

### Deterministic site producers and false-pass removal (CERT-005, packet 170)

- `packages/werkstatt/src/certification/producers/` owns the deterministic producer framework — typed producer registry with duplicate rejection (`CERT-PRODUCER-01`), profile validation (`CERT-PRODUCER-03` missing, `CERT-PRODUCER-04` extra), applicability evaluation (always/entitlement/config/surface rules), false-pass guard rejecting empty-result success (`CERT-PRODUCER-05`), summary-only warning success for mandatory requirements (`CERT-PRODUCER-06`), and grace-period success (`CERT-PRODUCER-07`).
- Diagnostic normalization deduplicates by `ruleId:file:line` and rejects missing `ruleId` or `message` (`CERT-PRODUCER-08`). Route/state/viewport matrix planning generates full combination sets for coverage.
- Producer execution constructs evidence envelopes from handler results, rejecting unregistered producers (`CERT-PRODUCER-09`), handler crashes (`CERT-PRODUCER-10`), and false-pass results (`CERT-PRODUCER-11`).
- No site-specific producer implementations, deployment commands, or I/O imports exist in this module.

### Independent evaluator agents and qualitative consensus (CERT-006, packet 180)

- `packages/werkstatt/src/certification/evaluators/` owns the independent evaluator framework — evaluator registry with duplicate rejection (`CERT-EVAL-01`), risk routing (ordinary/critical/borderline with dimension-matched rules, 1 evaluator for ordinary, 2 for critical/borderline), evaluator isolation rejecting self-review (`CERT-EVAL-02`) and duplicate identities (`CERT-EVAL-03`).
- Consensus aggregation maps pass/pass → pass, fail/fail → fail, disagreement/missing → incomplete (`CERT-EVAL-05`). Payload validation rejects bundle hash mismatch (`CERT-EVAL-07`), rubric mismatch (`CERT-EVAL-08`), out-of-range confidence (`CERT-EVAL-09`), unknown criteria and empty rationale (`CERT-EVAL-10`).
- Evaluator execution checks isolation (`CERT-EVAL-11`), registration (`CERT-EVAL-12`), handler crashes and invalid payloads (`CERT-EVAL-13`). Coverage manifest builds from routes/states/viewports and deterministic evidence.
- No evaluator-led mutation, human approval, or I/O imports exist in this module.

### Capability artifacts and sandbox (RFC-0863, packet 190)

- `packages/werkstatt/src/capability-artifacts/` owns the immutable content-addressed artifact store — publication with size/media-type policy (`CERT-ARTIFACT-01`/`CERT-ARTIFACT-02`), immutability (`CERT-ARTIFACT-03`), hash verification (`CERT-ARTIFACT-04`/`CERT-ARTIFACT-05`), and provider admission store (`CERT-ARTIFACT-06` non-pass, `CERT-ARTIFACT-07` stale conformance).
- `packages/werkstatt/src/isolation/broker/` owns the deny-by-default capability bridge — ambient host access rejection (`CERT-BROKER-01` fs/net/process/env/credential/descriptor/ipc/host-object), duplicate capability rejection (`CERT-BROKER-02`), policy/grant enforcement, request/response size limits, concurrency limits, and redacted audit entries.
- `packages/werkstatt/src/isolation/providers/` owns concrete sandbox adapter implementations with all 12 required `IsolationPropertyEvidenceV1` properties. The fake sandbox adapter is for testing only.
- No evolution controller, canary promotion, production agent capability, or provider-specific manifest field is introduced.

### Governed capability evolution controller (RFC-0864, packet 200)

- `packages/werkstatt/src/evolution/contracts.ts` owns candidates, stages, five-layer evidence bundles (definition, evaluation, observation, authority, artifact), transition records, and compensating actions. All are immutable, content-addressed, and lineage-bound.
- `packages/werkstatt/src/evolution/reducer.ts` owns the monotonic transition reducer — forward-only sequence `defined → tested → shadowed → canary → promoted` with rollback and quarantine as compensating transitions. Enforces idempotency keys, sequence numbers, kill switch (`CERT-EVO-01`), and evidence requirements per stage.
- `packages/werkstatt/src/evolution/guards.ts` owns Law Kernel, evidence, boundary, and kill-switch checks — self-change boundary for forbidden scopes (`CERT-EVO-GUARD-01`), evidence immutability (`CERT-EVO-GUARD-02`/`03`), authority expiry (`CERT-EVO-GUARD-05`), shadow side effects (`CERT-EVO-GUARD-06`), canary boundaries (`CERT-EVO-GUARD-07`/`08`/`09`), and evidence poisoning (`CERT-EVO-GUARD-10`/`11`).
- `packages/werkstatt/src/evolution/controller.ts` owns inspect/define/evaluate/observe orchestration. The controller cannot change Law Kernel, permissions, effect/isolation contracts, canonical identities/diagnostics, controller code, or evaluator policy.

### Deployment effect authority (CERT-007, packet 210)

- `packages/werkstatt/src/certification/deployment/authority.ts` owns signed external-effect authorization for Dev, Alt, and Main channel transitions. Gate requirements (`DEPLOYMENT_GATE_REQUIREMENTS`) enforce no force/skip/waiver/grace bypass paths for any gate.
- `authorizeDeployment` rejects unknown gates (`CERT-DEPLOY-01`), force (`CERT-DEPLOY-02`), skip (`CERT-DEPLOY-03`), waiver (`CERT-DEPLOY-04`), grace (`CERT-DEPLOY-05`), candidate mismatch (`CERT-DEPLOY-06`), non-pass gate decision (`CERT-DEPLOY-07`), missing artifact readiness (`CERT-DEPLOY-08`), and missing durable sync for Alt/Main (`CERT-DEPLOY-09`).
- `verifyMainPromotion` rejects candidate mismatch (`CERT-DEPLOY-10`), non-pass verification (`CERT-DEPLOY-11`), and missing durable sync (`CERT-DEPLOY-12`). Main does not become certified on traffic switch alone.
- `evaluateRollback` denies rollback during shared outage, when artifact is not ready, or when target is the same candidate. `evaluateCrashRecovery` resumes verification, restarts deployment, or quarantines with ambiguous state detection (`CERT-DEPLOY-13`).
- `buildDeploymentEffectRecord` creates deterministic content-addressed effect records. No success inference from deploy exit alone, no false Main success from incomplete verification.

### Continuous health and demotion (CERT-008, packet 220)

- `packages/werkstatt/src/certification/health/monitor.ts` owns continuous certification health and drift response — monitoring windows, health state transitions, drift classification, and incident response.
- `evaluateHealth` returns `current` (all pass), `degraded` (fail/stale/incomplete), with `CERT-HEALTH-01` for empty results. Fail triggers profile drift action, stale triggers retry, incomplete triggers retry. Shared outage overrides to `incident-only`.
- `shouldRevoke` checks consecutive degraded windows against threshold. `classifyDriftCause` identifies shared outage, expired evidence, candidate regression, public output drift, and late evidence.
- `evaluateScheduleWindow` enforces idempotency with duplicate detection and late delivery rejection. `buildHealthDecision` appends decisions without editing historical gate decisions. `buildHealthProjection` creates deterministic projections.
- `evaluateMonitorRecovery` resumes from requirements/health-decision/incident/projection/complete with `CERT-HEALTH-02` ambiguous state. `isHealthTransitionValid` validates state transitions. No silent overwrite of newer health decisions, no monitor failure masquerading as current health.

### Single-site clean cutover (CERT-009, packet 230)

- `packages/werkstatt/src/certification/cutover/marker.ts` owns the clean cutover marker and legacy state prohibition for single-site republishing through the new complete pipeline.
- `CleanCutoverMarkerV1` is the explicit marker containing new candidate, all decision IDs (dev, alt, main verification, evaluator), dossier root, Main identity (candidate, artifact hash, deployment URL, timestamp), health state, rollback target identity, bootstrap exception closure, continuous health window completion, and deterministic marker hash.
- `verifyCutover` rejects legacy state reads for success (`CERT-CUTOVER-01`), missing dev decision (`CERT-CUTOVER-02`), missing alt decision (`CERT-CUTOVER-03`), missing main verification (`CERT-CUTOVER-04`), missing evaluator decisions (`CERT-CUTOVER-05`), incomplete health window (`CERT-CUTOVER-06`), revoked health (`CERT-CUTOVER-07`), same rollback candidate (`CERT-CUTOVER-08`), and invalid component set hash (`CERT-CUTOVER-09`).
- `checkLegacyStateProhibition` enforces no runtime command reads legacy release certification, grace, or mission artifacts for success. `verifyMarkerIntegrity` detects tampering via hash recomputation.
- `isBootstrapExceptionClosed` and `isRollbackTargetProtected` enforce bootstrap rollback target protection until the exception is closed, and permanent protection for prior-certified targets. No legacy state import, no cutover without complete certification path.

### Post-cutover legacy artifact cleanup (CERT-010, packet 240)

- `packages/werkstatt/src/certification/cleanup/legacy-artifacts.ts` owns the post-cutover legacy artifact cleanup — idempotent inventory/plan/apply command for removing proven-obsolete heavy payloads.
- `CleanupInventoryV1` records legacy + protected artifacts with byte counts and deterministic hash. `CleanupPlanV1` binds paths to delete/protect with total bytes to free and plan hash. `CleanupTombstoneV1` records each deletion. `CleanupReportV1` reports freed bytes, remaining protected, mirror verification, and recovery possibility.
- `verifyCleanupPrerequisites` enforces cutover marker (`CERT-CLEANUP-01`), bootstrap exception closed (`CERT-CLEANUP-02`), main-certified candidate (`CERT-CLEANUP-03`/`04`), durable dossier (`CERT-CLEANUP-05`), mirrors (`CERT-CLEANUP-06`), rollback references (`CERT-CLEANUP-07`).
- `validatePlan` rejects plan hash drift (`CERT-CLEANUP-08`), inventory hash drift (`CERT-CLEANUP-09`), unknown paths (`CERT-CLEANUP-10`), and protected paths in deletion plan (`CERT-CLEANUP-11`). `checkPathSafety` rejects symlinks outside allowed roots.
- Dry-run is default; apply requires exact plan hash. `isSafeNoOp` detects idempotent re-apply. `verifyReportIntegrity` validates freed bytes match tombstone sum. No deletion without cutover marker, no deletion of protected artifacts, no silent plan drift.

### RFC-0855 post-completion discipline

- All 25 packets (000–240) are completed. The engine owns the Law Kernel, component graph, lifecycle fibers, effects, resolved-set identity, isolation admission, certification authority, and evolution reducer. Stack-profile packages provide capabilities through contracts and must never be imported into the engine.
- Do not add adapters for `werkstatt/plugin@1`, force unload, ambient authority, local certification fallback, mutable capability artifacts, or ungoverned production activation.
- Future changes to certification/component runtime require a superseding RFC, not amendments to completed packets.
- Leitstand deployment commands remain blocked with `CERT-TRANSITION-01` until CERT-007 is connected to the Leitstand command surface. This reconnection is a future task.

### Component and capability contracts (RFC-0858)

- `packages/werkstatt/src/component/` owns strict versioned contracts for immutable component artifacts, namespaced capability provides/requires, attenuated grants, closed effect declarations, isolation requirements, lifecycle-owned resources, and canonical resolved-component-set identity.
- `contracts.ts` exports TypeScript interfaces; `schemas.ts` exports Zod runtime schemas with `.strict()` validation; `identity.ts` computes canonical hashes via the existing fingerprint authority (`snapshotCanonicalJsonObjectV1` + `canonicalJsonHashV1`); `index.ts` provides narrow public exports.
- Unknown fields, invalid identities, duplicate provides, Law Kernel reserved grant scopes (`certify`, `administer`), resource owner mismatches, and unknown effect/isolation/grant/resource types fail with `COMPONENT-CONTRACT-01` through `COMPONENT-CONTRACT-07`.
- `computeSetHash` is input-order invariant and sensitive to every semantic field change. `verifySetHashStrict` detects set-hash mismatch (`COMPONENT-CONTRACT-07`).
- No registry, loader, sandbox, plugin adapter, or activation behavior exists in this module. Later packets implement lifecycle and resolution against these types.

### Lifecycle fiber and effect runtime (RFC-0859)

- `packages/werkstatt/src/component-runtime/` owns the structured-concurrency runtime: lifecycle state machine, component fibers, effect handlers, and activation transaction.
- `lifecycle.ts` exports a closed state machine (`declared → waiting → loading → active → draining → unloading → disposed` plus `failed`/`quarantined`). Invalid transitions are rejected with `LIFECYCLE-01`/`LIFECYCLE-02`.
- `effects.ts` exports four effect handlers: `RevertibleEffectHandler` (disposer required), `TransactionalEffectHandler` (prepare/commit/abort with idempotency), `CompensatableEffectHandler` (compensation with equivalence evidence), `IrreversibleEmissionEffectHandler` (withheld until commit). Failed rollback quarantines.
- `fiber.ts` exports `ComponentFiber` — structured ownership of child operations/resources, bounded drain with deadline, LIFO effect unwind, cancellation propagation at declared boundaries.
- `activation.ts` exports `ActivationTransaction` — bounded set transition with prepare/commit/abort, prior-set drain in reverse dependency order, quarantine on incomplete rollback.
- No resolver, sandbox, certification, or production activation occurs in this module. Packet 070 implemented resolution; packet 230 completed the single-site clean cutover marker.

### Deterministic component resolution and reconciliation (RFC-0860)

- `packages/werkstatt/src/component-runtime/resolver.ts` owns pure deterministic dependency resolution: validates manifests, checks artifact availability, verifies admitted grants, matches required capabilities by namespace/compatibility/schema identity, rejects zero/multiple providers, detects cycles, topologically sorts with canonical component-ID tie-breaking, computes graph/set identities through RFC-0858.
- `packages/werkstatt/src/component-runtime/reconciliation.ts` owns pure desired-state diff and transaction orchestration: computes stop/drain/unload/load/activate plans, detects no-op (unchanged setHash), drives RFC-0859 activation transaction.
- `packages/werkstatt/src/component-runtime/resolution-proof.ts` exports bounded proof/diagnostics types: `ResolutionProofV1`, `ResolutionViolationV1` with codes `RESOLUTION-01` through `RESOLUTION-08`.
- Resolution is deterministic under input permutation. Missing, incompatible, ambiguous, cyclic, unadmitted, or artifact-mismatched graphs are blocked before lifecycle mutation.
- No package/network discovery, fallback providers, cycle tolerance, or plugin adapters. Production activation via the clean cutover marker is implemented (packet 230 completed).

### Runtime reflection and conformance harness (RFC-0861)

- `packages/werkstatt/src/component-runtime/reflection.ts` owns the read-only, policy-filtered live capability catalog: `CapabilityCatalogV1`, `CapabilityCatalogEntryV1`, `createCapabilityCatalog`, `assertNoForbiddenFields`. Catalog entries are canonically ordered, exact-set-bound, caller-filtered, and omit secrets, raw grants, private state, credentials, prompts, executable bytes, and authority material.
- `packages/werkstatt/src/component-runtime/conformance.ts` owns scenario/result contracts: `ConformanceScenarioV1`, `ConformanceEventV1`, `ConformanceExpectationV1`, `ConformanceResultV1`, `ConformanceTraceEntryV1`, `ConformanceMismatchV1`, `ConformanceCleanupReportV1`. Results are always marked `testOnly: true` and contain no admission/promotion decision.
- `packages/werkstatt/src/component-runtime/testing/harness.ts` owns the test-only conformance harness: `runConformanceScenario`, `buildCatalog`, `TrustedFixture`. Guards reject non-test mode (`CONFORMANCE-01`), untrusted fixtures (`CONFORMANCE-02`), unpinned artifacts (`CONFORMANCE-03`), and hash mismatches (`CONFORMANCE-04`). Fixtures are embedded, hash-pinned, and trusted — no network/package discovery.
- Subpath exports: `@warpgogol/werkstatt-engine/component-runtime/reflection`, `@warpgogol/werkstatt-engine/component-runtime/conformance`, `@warpgogol/werkstatt-engine/component-runtime/testing`.
- No production define/install/run/activate/promote command or authority decision is exported. Reflection and conformance results are projections/evidence, not authority.

### Provider-neutral isolation contract (RFC-0862)

- `packages/werkstatt/src/isolation/contracts.ts` owns neutral adapter/workload/bridge contracts: `IsolationAdapterV1`, `SandboxedWorkloadCreateV1`, `SandboxedWorkloadV1`, `CapabilityBridgeRequestV1`, `CapabilityBridgeResponseV1`, `TerminationReportV1`, `AttenuatedGrantSetV1`, `WorkloadLimitsV1`, `IsolationPropertyEvidenceV1`, `IsolationConformanceResultV1`. Workloads receive no ambient filesystem, network, process, environment, clock, randomness, credential, IPC, or host-object access.
- `packages/werkstatt/src/isolation/schemas.ts` owns strict Zod schemas with `.strict()` validation for all isolation messages, grants, limits, and evidence. Unknown fields, invalid grants, replay, confused identity, and all bound violations are rejected. `validateIsolationAdapter` and `validateBridgeRequest` are the public validators.
- `packages/werkstatt/src/isolation/conformance.ts` owns the provider-neutral adversarial conformance suite: `runIsolationConformance`, `createConformanceResult`. Covers filesystem/network/process/env/credential/descriptor escape, resource exhaustion, workload separation, teardown, crash, bridge confusion/replay. `node:vm`, `worker_threads`, and ordinary subprocesses fail the security-tier contract by definition. Missing property evidence returns `incomplete`, never `pass`.
- Subpath exports: `@warpgogol/werkstatt-engine/isolation/contracts`, `@warpgogol/werkstatt-engine/isolation/schemas`, `@warpgogol/werkstatt-engine/isolation/conformance`.
- No concrete provider dependency, credential, artifact store, network endpoint, or production loader is added. Packet 190 selects and implements the first real provider.

### Certification contracts and identity builders (RFC-0853)

- `packages/werkstatt/src/certification/contracts/` owns strict Zod schemas and inferred types for all CERT-001 certification objects: identifiers, release candidates, policy bundles, evidence envelopes, dossier events, gate/main/health decisions, action packs, authority artifacts, and deployment operation state/events. All schemas use `.strict()` validation — unknown fields fail without coercion.
- `packages/werkstatt/src/certification/identity.ts` owns explicit identity builders for each certification object. Each builder constructs a fresh payload object field-by-field, snapshots through RFC-0849 `snapshotCanonicalJsonObjectV1`, and hashes through `canonicalJsonHashV1`. No clone/delete, generic hash, object spread from source, or parallel interface exists.
- Identity payloads include only semantic fields — excluded fields (candidate IDs, evidence IDs, event IDs, timestamps, locators, observed environments) do not affect identity digests. Included field changes (source hashes, content hashes, policy bundle roots, binding hashes, statuses, event kinds, task lists) always produce different digests.
- Evidence identity enforces redaction closure: unresolved redaction reports fail with `CERT-REDACTION-01` before identity construction.
- Subpath export: `@warpgogol/werkstatt-engine/certification`.
- No evaluation algorithms, state cutover, storage, commands, producers, adapters, authority execution, or deployment logic exists. Later packets implement those concerns.

### Deterministic certification evaluation and remediation (RFC-0850)

- `packages/werkstatt/src/certification/evidence-selection.ts` owns a single-pass bounded evidence index (`buildEvidenceIndex`) and authority-sequence selection (`selectRequirementEvidence`). The index is built once per decision in O(E) time, keyed by requirement ID. Selection chooses the eligible record with greatest authority `admissionSequence` at or below the immutable `evaluationCutSequence`. Producer timestamps, filenames, mtimes, lexical IDs, and input array order never establish precedence.
- `packages/werkstatt/src/certification/aggregation.ts` owns deterministic certification aggregation (`evaluateCertificationDecision`). Resolves required/conditional/advisory requirements, selects at one immutable cut, preserves per-requirement `pass | fail | stale | incomplete | not-applicable`, applies top-level precedence `fail > stale > incomplete > pass`, records selected evidence IDs, coverage counts, and reason codes. Never infers pass from zero requirements, zero diagnostics, process exit 0, old evidence, producer crash, timeout, infrastructure unavailability, or unknown values.
- `packages/werkstatt/src/certification/action-pack.ts` owns deterministic anchored action-pack construction (`buildCertificationActionPack`). Creates one canonical task per actionable non-pass requirement, classifies `product-fix | infrastructure-retry | policy-defect`, validates anchors and verification commands, detects dependency cycles, and returns stable topological order with lexical tie-breaker. Missing anchors, vague tasks, missing verification commands, cycles, or >1000 tasks fail with `CERT-ACTION-01` or `CERT-LIMIT-03`.
- `packages/werkstatt/src/certification/dossier-hash.ts` owns pure event/root hashing (`computeDossierEventHash`, `computeDossierRoot`). Event hashing uses RFC-0853 `buildDossierEventIdentityV1`. Root hashing binds exact order — reordering, insertion, removal, or prior-hash changes alter the root; storage location and projection timestamps do not.
- Hard limits: 1,000 requirements (`CERT-LIMIT-01`), 10,000 evidence records (`CERT-LIMIT-02`), 1,000 action tasks (`CERT-LIMIT-03`). All overflow returns explicit non-pass failures without truncation.
- Complexity: indexing/selection/aggregation in O(E + R log R) time and O(E + R) memory. No per-requirement full evidence scan. Action-pack ordering in O(T + D + T log T).
- No function reads/writes `releases/**`, `missions/**`, `systems-cache/**`, object storage, URLs, clocks, environment variables, or provider APIs. All modules are pure and independently testable.

## Kernel command registration (RFC-0960)

- Every `KernelCommandDefinition` MUST declare `modulePath`: a repo-relative path to the implementing source file (e.g. `packages/werkstatt-site/src/checks/robots.ts`). This is **required on ALL commands** — not just `.generate` commands. It is distinct from `modulePaths` (ADR-0024, relative to `src/`, for cache hashing).
- Every `.generate` command and every command with non-empty `writes` MUST declare `generates: GeneratedArtifactSpec[]`. Commands with `writes` but no generated files declare `generates: []`. Each spec includes `path`, `phase` (`build.prepare` | `build.post` | `on-demand`), optional `conditional`, and optional `markerPolicy` override.
- `validateRegistration(registry)` enforces completeness at registry build time via `config.postBuildValidation`. It checks: non-empty `modulePath`, `generates` on `.generate`/`writes` commands, exempt list consistency, and non-glob path uniqueness. Fail-closed: throws on any violation.
- `KernelRuntimeContext` carries `registry: KernelRegistry` and `ownershipMap?: GeneratorOwnershipEntry[]` (pre-computed via `buildGeneratorOwnership`). Validators consume `context.ownershipMap` instead of a static constant.
- The static `GENERATOR_OWNERSHIP_MAP` is deleted. Ownership is derived by `buildGeneratorOwnership(registry)` from `generates[]` declarations. The derivation function lives in the site plugin (`@warpgogol/werkstatt-site/checks`).
- `KernelAppConfig` has an optional `postBuildValidation?: (registry: KernelRegistry) => void` callback. The workspace `tools/kernel.config.ts` wires `validateRegistration` from the site plugin.
- **RFC-0963 (DNA-91):** Every validator command (name ending in `.validate`, `.check`, or `.lint`) MUST declare `contract: string` (validation domain) and `rules: string[]` (rule IDs it can emit, empty if non-emitting). `validateRegistration` emits warnings for missing fields. `validator.inventory.generate` fails closed if any validator lacks these fields (unless `--dry-run`).

## Mission git helpers

- `commitWorkpieceIfDirty(workpieceDir, missionId)` (RFC-0644): auto-commits all dirty files in the workpiece via `git add -A` + `git commit --no-verify`. Returns `{ committed: boolean, commitSha: string | null }`. Used by `mission.reconcile` and `mission.close` (RFC-0797) to auto-commit dirty workpieces instead of throwing.
- `commitCacheCloneIfDirty(systemDir, systemId)` (RFC-0797): auto-commits all dirty files in the cache clone via `git add -A` + `git commit --no-verify`. Returns `{ committed: boolean, commitSha: string | null }`. Used by `mission.reconcile` (before the dirty guard) and `mission.validate` (post-validate cleanup) to auto-commit generated files instead of leaving the cache clone dirty.
- **3-tier branch resolution for cache clone git operations** (RFC-0987): Always resolve the current branch using `git symbolic-ref --short HEAD` first (returns current branch when not detached). If that fails (detached HEAD), try `git symbolic-ref --short refs/remotes/origin/HEAD` (remote default branch). If that also fails, fall back to `"main"`. Never use `git rev-parse --abbrev-ref HEAD` — it returns `"HEAD"` in detached state, producing invalid refspecs for `pull`, `push`, and `reset` commands. This pattern is used in `commitAndPushBordbuch` (`bordbuch-io.ts`) and `syncCacheClone` (`mission-materialize.ts`).

## Mission close dist-reuse prerequisite (RFC-0918)

- `mission.close` runs `mission.validate` inline before acquiring locks. The inline validate call does NOT pass `force: true`, so the RFC-0635 distribution-reuse path is active by default: if `distribution/build-input-hash.json` matches the current workpiece state and `distribution/dist/` exists, the full build is skipped and dist is copied from the cache clone.
- Run `release.prepare` or `mission.validate` before `mission.close` to produce `distribution/build-input-hash.json` that enables dist reuse (RFC-0635). Without this, `mission.close` runs a full build which may trigger the rebuild cycle (RFC-0918).
- `mission.reconcile` includes a post-push divergence check (RFC-0918): after pushing to origin, it compares cache clone HEAD against `origin/main` using `git rev-parse`. If the SHAs differ, a `divergenceWarning` is logged and included in the reconciliation report. This is a non-fatal diagnostic — it does not block reconcile.
- The band-aid fix from 6.92.5 (updating `workpieceHeadAtReconcile` after auto-commit in `mission.close`) remains as a safety net for the full-build path when dist reuse is not active.

## Boot-smoke runtime verification (RFC-0961, RFC-0979)

- `src/release/boot-smoke.ts` owns the `release.boot-smoke` command: route planner, binding simulator, egress interceptor, and miniflare boot logic.
- `release.boot-smoke` is registered in `release.module.ts` (not `index.ts` barrel — AGENTS.md command registration discipline). Flags: `--site` (required), `--dist`, `--wrangler-config`, `--languages`, `--diagnose`.
- `resolveWranglerConfig(distDir, wranglerConfigFlag, workspaceRoot)` (RFC-0979) — resolves wrangler config path: `--wrangler-config` flag → Astro-generated `dist/server/wrangler.json` → `dist/../wrangler.jsonc` → workpiece `missions/workpiece/wrangler.jsonc`. Returns `null` if none found. When using Astro-generated config, `bootSmokeDistDir` is set to `dist/server/`.
- `resolveLanguages(distDir, languagesFlag)` (RFC-0979) — parses `--languages` comma-separated flag, or falls back to `detectBootSmokeLanguages(distDir)` (RFC-0978 dynamic detection from `dist/client/`).
- `planBootSmokeRequests({ distDir, languages })` — pure function that reads `surface.generated.json` from distDir to discover route-template kinds; picks root, one route per language, one API route, one static asset, and an intentional 404 probe.
- `simulateBindings(wranglerConfig)` — pure function that maps wrangler binding declarations to in-memory equivalents: KV→Map, R2→Map, D1→type marker, Vectorize→JSON-compatible placeholder (`{ __type: "vectorize" }`), vars/secrets→placeholder strings, ASSETS→type marker. Unknown binding types (e.g. `durable_objects`) are reported in `missingBindings` (fail-closed). Miniflare 3 `bindings` option accepts only JSON-serializable values — function stubs cause validation errors. The worker code checks for binding existence at runtime and returns 503 if missing, so a placeholder object is sufficient for boot-smoke.
- Egress interceptor blocks all external `fetch()` calls; localhost requests are allowed for miniflare internal routing.
- `release.prepare` calls `runBootSmoke` directly (not through `runBootSmokeCommand`) after `build.post` and before snapshot capture; persists `boot-smoke.json` as release evidence; `ReleaseManifest` includes `bootSmokeVerdict: pass|fail`. Assets directory from wrangler config is resolved to an absolute path before passing to Miniflare — workerd rejects relative paths containing `..` (e.g. `../client` in Astro-generated `wrangler.json`).
- `runBootSmokeCommand` (standalone) writes `boot-smoke.json` to `distDir/` after execution (RFC-0979). `release.prepare` uses a staging dist, so the file lands in staging naturally — no duplication.
- `leitstand.dev-deploy` pre-flight includes `boot-smoke-evidence` check — asserts `releases/{releaseId}/boot-smoke.json` exists. No legacy exemption: all releases must have boot-smoke evidence.
- `miniflare` is an `optionalDependency` — dynamically imported at runtime. Type declaration shim at `src/types/miniflare.d.ts`.

## Env file persistence (RFC-0822)

- `persistEnvFilesToCacheClone(workpieceDir, cacheCloneDir)` (RFC-0822): copies `.env*` files from workpiece to cache clone (untracked). Excludes `.env.example` and `.env.*.example`. Used by `mission.close` as a final step. Non-fatal on failure.
- `restoreEnvFilesFromCacheClone(cacheCloneDir, workpieceDir)` (RFC-0822): restores `.env*` files from cache clone to workpiece after `atomicMoveDir`. Replaces `PUBLIC_IMAGE_PROVIDER` with `build-portable`. Used by `mission.materialize`. Non-fatal on failure.
- `sternsystem.validate` emits `ENV-PERSIST-01` warning when cache clone lacks `.env*` but active workpiece has them.

## Operator config file persistence (RFC-0840)

- `OPERATOR_CONFIG_FILES` constant in `operator-config-files.ts` declares the canonical list of operator config files to persist: `[".lighthouse-budget-ignore", "src/image-delivery.config.yaml"]`. Entries are path-based (not just filenames) to support files in subdirectories. Adding a new file requires a superseding RFC.
- `persistOperatorConfigFiles(workpieceDir, cacheCloneDir)` (RFC-0840): copies each file in `OPERATOR_CONFIG_FILES` from workpiece to cache clone (untracked). Uses `path.join` with subpath entries. Non-fatal on failure. Used by `mission.close` after `persistEnvFilesToCacheClone`.
- `restoreOperatorConfigFiles(cacheCloneDir, workpieceDir)` (RFC-0840): restores each file from cache clone to workpiece after `atomicMoveDir`. Creates parent directories with `mkdir { recursive: true }`. Does NOT modify file contents. Non-fatal on failure. Used by `mission.materialize` after `restoreEnvFilesFromCacheClone`.
- `materialize.config.validate` (RFC-0840): workspace-scope check command in `PACKAGES_CHECK_PIPELINE`. Emits MAT-CONFIG-01 (warning: unrecognized operator file in workpiece root or `src/`) and MAT-CONFIG-02 (error: dead entry in `OPERATOR_CONFIG_FILES` not found in any workpiece or cache clone).
- `workpiece.config.presence.check` (RFC-0844): pre-build gate in `mission.validate` that verifies all `OPERATOR_CONFIG_FILES` entries are present in the active workpiece before the build pipeline starts. Runs before the Playwright Chromium pre-flight (RFC-0813). Returns `status: "fail"` with restore commands for each missing file. Non-fatal if the check command itself throws. Skipped on distribution-reuse path.
- `validate.postbuild` (RFC-0883): post-build-only validation command for fast iterative debugging. Runs `sites-check.postbuild` pipeline on an existing `dist/` directory without a full rebuild. Accepts `--mission` or `--site` to resolve the workpiece, and `--skip-slow` to skip `mobile.layout.check`, `lighthouse.budget.check`, and `qa.independent.run`. Fails fast with exit code 1 if `dist/` is missing. Always prints a stale `dist/` warning. Does NOT replace `mission.validate` as the authoritative validation command.

## Autonomy guard

The `werkstatt.autonomy.validate` command enforces DNA-64. It scans `packages/werkstatt/src/**` for `@warpgogol/*` import specifiers. Exemptions:

- `@warpgogol/werkstatt-engine` (self-imports)
- `@warpgogol/werkstatt-site/ontology`, `@warpgogol/werkstatt-site/share` (shared schema subpaths)
- `@warpgogol/forge` (governance)
- `@warpgogol/werkstatt-site/passport`, `@warpgogol/werkstatt-site/observability`, `@warpgogol/werkstatt-site/integration`, `@warpgogol/werkstatt-site/surface` (shared infrastructure subpaths)

Excludes: `node_modules/`, `tests/`, `tests-handoff/`, `*.test.ts`, `*.spec.ts`.

## Command handler patterns

- **Kernel command output standard (DNA-82, RFC-0903).** Every kernel command handler MUST return a `KernelCommandResult` where: (1) `exitCode` is explicitly set on every return path (both `0` and `1`); (2) `summary` is present on every return path and starts with the `[command.name]` prefix (e.g. `"[nachweis.sign] OK"`); (3) `nextSteps` is present and non-empty when `exitCode` is `1`, containing at least one `KernelNextStep` with `kind: "required"`. On success, `nextSteps` is optional. Enforced by `werkstatt.commands.validate` (static analysis). Use `passResult`/`failResult`/`diagnosticsResult` from `@warpgogol/werkstatt-shared/checks` for compliant output by default — returns that delegate to these helpers are exempt from scanning.

- **Extract error-return helpers for command handlers.** When a kernel command handler returns the same `KernelCommandResult<T>` error shape (same `data` fields with `exitCode: 1`) from multiple code paths, extract a `makeErrorResult(...)` helper. This eliminates Fowler's Duplicated Code smell and makes future field additions a single-point change. Example: `nachweis-assessment-ingest.ts` reduced from ~613 to ~480 lines by extracting `makeErrorResult(systemId, bundle, dryRun, summary)`.

- **Use narrow credential regex patterns in assessment bundles.** When scanning assessment bundles for credential leakage, use specific key names (`aws_secret_access_key`, `private_key`, `client_secret`) rather than generic `secret`/`password` substrings. Generic patterns produce false positives on legitimate assessment data containing field names like `"secret": "some-value"`. The narrowed patterns are in `CREDENTIAL_PATTERNS` in `nachweis-assessment-ingest.ts`.

- **Extract advisory/non-blocking checks into exported pure functions.** When a kernel command handler contains an inline advisory check (non-blocking warning, pre-flight check, or soft validation that logs but does not block), extract it into a separate exported pure function that takes `(workspaceRoot, systemId, logger)` and can be tested independently. This follows the pure function + thin handler pattern: the handler calls the extracted function, the test creates a temp bare repo and verifies the warning output. Example: `checkMirrorSyncPreFlight` in `leitstand-commands.ts` (RFC-0995).

## nachweis.measure.lighthouse (RFC-0874)

`nachweis.measure.lighthouse` is a provider adapter that runs five sequential canonical Google Lighthouse runs against a target HTTPS URL, parses the LHR JSON output, aggregates category scores, builds an `AssessmentBundleV1`, and delegates to `nachweis.assessment.ingest` (RFC-0873) for R2 upload, PBP write, and Bordbuch append.

- **Chrome/Chromium dependency:** Lighthouse requires Chrome/Chromium installed. The command checks for Chrome at common paths (`/usr/bin/google-chrome`, `/usr/bin/chromium`, etc.) or via `CHROME_PATH` env variable. If not found, fails with `LIGHTHOUSE_CHROME_NOT_FOUND` before any runs begin.
- **Lighthouse dependency:** Pinned to exact version `13.4.1` in `optionalDependencies`. The command uses `npx lighthouse` CLI subprocess, not a static import — this keeps the engine stack-agnostic (DNA-64).
- **Canonical run validity:** A run is valid if Lighthouse exits 0, LHR JSON parses, no `runtimeError` (or `NO_ERROR`), and `requestedUrl`/`finalUrl`/`lighthouseVersion`/`fetchTime` are present. Any invalid run fails the batch with `LIGHTHOUSE_CANONICAL_BATCH_INCOMPLETE`.
- **Numeric category aggregation:** Categories with `score` in [0, 1] are scaled to 0-100. Five samples are sorted, median (index 2) is the aggregated score. `min`, `max`, and `samples[]` are preserved.
- **Non-numeric category aggregation:** Categories with `score: null` and `experimental: true` (e.g. Agentic Browsing) are projected as `numerator`/`denominator`/`status` — never coerced to 0-100. `experimental: true` is preserved in the bundle.
- **Deterministic observedAt:** `observedAt` is set from the first canonical run's `fetchTime`, not `new Date()`.
- **Entitlement gating:** Skips silently when `nachweis` entitlement is not resolved (same as all nachweis commands).
- **Dry-run:** `--dry-run` returns immediately without running Lighthouse or ingesting.
- **No duplication:** The adapter does not duplicate R2 path construction, SHA-256 hashing, PBP persistence, or Bordbuch append logic — it produces an `AssessmentBundleV1` and calls `runNachweisAssessmentIngest` directly.

## nachweis.measure.cloudflare-agent-readiness (RFC-0875)

`nachweis.measure.cloudflare-agent-readiness` is a provider adapter that submits an Unlisted Cloudflare URL Scanner scan with `agentReadiness: true`, polls the result endpoint until completion, parses Agent Readiness dimensions, builds an `AssessmentBundleV1`, and delegates to `nachweis.assessment.ingest` (RFC-0873) for R2 upload, PBP write, and Bordbuch append.

- **Credentials:** Requires `CLOUDFLARE_URL_SCANNER_ACCOUNT_ID` and `CLOUDFLARE_URL_SCANNER_API_TOKEN` env vars. Fails with `CLOUDFLARE_CREDENTIALS_MISSING` if absent.
- **API endpoints:** `POST /client/v4/accounts/{accountId}/urlscanner/v2/scan` for submission, `GET /client/v4/accounts/{accountId}/urlscanner/v2/result/{scanId}` for polling. Uses `fetch()` (Node 18+ built-in) — no external HTTP library.
- **Unlisted visibility:** Scans are submitted with `visibility: "Unlisted"` by default — results are not publicly indexed.
- **Polling:** 15-second intervals, 5-minute max elapsed. HTTP 404 = in progress, HTTP 200 + `task.success: true` = complete, HTTP 200 + `task.success: false` = `CLOUDFLARE_SCAN_FAILED`, timeout = `CLOUDFLARE_SCAN_TIMEOUT`.
- **Parser:** Uses explicit field paths (`result.agentReadiness.checks.<id>.status`, `.details`) — no heuristic field-name matching. Fails with `ASSESSMENT_SCHEMA_UNSUPPORTED` if `agentReadiness` is absent.
- **Not-checked dimensions:** Mapped to `status: "not-checked"` — never coerced to `score: 0`.
- **Unknown dimensions:** Preserved from the provider response — dimensions are not hard-coded.
- **Deterministic observedAt:** Set from `result.scan.finishedAt` or `result.scan.createdAt`, not `new Date()`.
- **Raw artifacts:** `cloudflare-submission.json` and `cloudflare-result.json` are preserved as bundle artifacts.
- **No duplication:** Same as Lighthouse — the adapter produces an `AssessmentBundleV1` and calls `runNachweisAssessmentIngest` directly.

## nachweis.consent.update and display↔consent coupling (RFC-0886)

`nachweis.consent.update` requires a `--scope` flag (`document|screenshot|websiteLink`) and updates `consentScope[scope]` instead of the removed `consentStatus`. The publication gate enforces display↔consent consistency via the `display-consent-consistent` condition (required for `attestation-v1` only).

- **`--scope` is required:** The command fails if `--scope` is missing or not one of `document`, `screenshot`, `websiteLink`.
- **Per-aspect consent:** Each aspect (`document`, `screenshot`, `websiteLink`) is updated independently. Updating one scope preserves the others.
- **Gate logic:** `consent-granted` and `display-consent-consistent` pass when every display aspect that is `"visible"` has `consentScope[aspect].status === "granted"`. When no aspects are visible (or `display` is absent), both conditions pass (vacuous truth — grandfathered for pre-RFC-0885 records).
- **Policy scope:** `display-consent-consistent` is required only for `attestation-v1`. It is NOT required for `operational-measurement-v1` or `technical-assessment-v1`.
- **Validation:** `nachweis.validate` reports `NACHWEIS-DISPLAY-CONSENT-01` violations when a visible display aspect lacks granted consent.

## nachweis.screenshot.upload (RFC-0886)

`nachweis.screenshot.upload` uploads a website screenshot to R2 and updates `EvidenceSource.websiteScreenshot`.

- **Supported extensions:** `.webp`, `.png`, `.jpg`, `.jpeg`. Other extensions fail with an error.
- **R2 path:** `{systemId}/screenshots/{slug}/website-screenshot{ext}` — separate from evidence PDF paths (`{systemId}/public/...`).
- **SHA-256:** Computed from the file, stored in `websiteScreenshot.sha256`.
- **Dry-run:** `--dry-run` skips R2 upload and entity update, returns the computed hash and R2 key.
- **Bordbuch:** Appends a `nachweis-record` entry with `screenshotSha256` and `mediaType` metadata.

## nachweis.screenshot.ingest (RFC-0890)

`nachweis.screenshot.ingest` ingests a raw full-page screenshot to R2 private storage and the cache clone local directory. It is the entry point for raw screenshot archival.

- **R2 path:** `{systemId}/screenshots/{slug}/raw/{originalFilename}` — private storage, separate from the display variant.
- **Local path:** `{cachePath}/trust/evidence/screenshots/{slug}/raw/{originalFilename}` — gitignored binary artifact.
- **Image metadata:** Detected from file content via dynamic `import("sharp")` — mediaType, width, height. No static `sharp` dependency in `werkstatt` (DNA-64).
- **Filename parsing:** `CaptureX_YYYY-MM-DD_HHMMSS_domain.ext` → `capturedAt: YYYY-MM-DDTHH:MM:SSZ`. Non-matching filenames leave `capturedAt` unset (not an error).
- **`--captured-at` flag:** ISO 8601 with timezone (e.g. `2026-08-20T13:44:40Z`), overrides filename-parsed value.
- **Idempotency:** Re-ingest of the same SHA-256 skips R2 upload, local copy, and Bordbuch append. Returns existing metadata with `alreadyIngested: true`.
- **Schema:** Updates `EvidenceSource.websiteScreenshot.rawArtifact` with `{ sha256, mediaType, originalFilename, width, height, r2Key, localPath, capturedAt? }`. Display fields (`sha256`, `mediaType`, `storage`) are preserved if already present.
- **Dry-run:** `--dry-run` computes metadata without copying or uploading.
- **Bordbuch:** Appends a `nachweis-record` entry with `rawScreenshotSha256`, `mediaType`, `originalFilename`, `width`, `height` metadata.
- **Relationship to `nachweis.screenshot.upload`:** The two commands are independent — either can run first. `upload` populates display fields; `ingest` populates `rawArtifact`. `upload` must not overwrite an existing `rawArtifact`.

## nachweis.screenshot.process (RFC-0891)

`nachweis.screenshot.process` transforms a raw full-page screenshot into a 16:9 display variant (1280x720, WebP) and uploads it to R2 public storage. It reads `websiteScreenshot.rawArtifact` from the evidence-source entity.

- **R2 path:** `{systemId}/screenshots/{slug}/website-screenshot.webp` — public storage, always `.webp`.
- **Raw file resolution:** Checks cache clone local path first (`{cachePath}/trust/evidence/screenshots/{slug}/raw/{originalFilename}`), falls back to R2 private download via `downloadFromR2(rawArtifact.r2Key)`.
- **Crop strategy:** 16:9 region from the top of the raw image. `cropHeight = min(round(rawWidth * 9 / 16), rawHeight)`. If `cropHeight === rawHeight` (portrait images), `cropWidth = round(rawHeight * 16 / 9)` and the crop is centered horizontally.
- **Sharp pipeline:** `.extract({ left, top, width, height }).resize(1280, 720, { fit: "cover" }).webp({ quality: 80 })`. Uses dynamic `import("sharp")` — no static dependency in `werkstatt` (DNA-64).
- **`--crop-offset` flag:** Vertical crop offset in pixels (default: 0). Fails with max-offset error if `cropOffset + cropHeight > rawHeight`.
- **Entity update:** Updates `websiteScreenshot` with `{ sha256, mediaType: "image/webp", storage: "public", url: r2Key, capturedAt }`. Preserves `rawArtifact` — does not delete or overwrite it.
- **`capturedAt` propagation:** Copied from `rawArtifact.capturedAt` to the display variant. If `rawArtifact.capturedAt` is unset, `capturedAt` is `null`.
- **Dry-run:** `--dry-run` computes crop dimensions and returns metadata without uploading or updating the entity.
- **Bordbuch:** Appends a `nachweis-record` entry with `displaySha256`, `displayMediaType`, `displayWidth`, `displayHeight`, `rawSha256`, `r2Key` metadata.
- **Relationship to `nachweis.screenshot.ingest`:** `ingest` (RFC-0890) must run first to populate `rawArtifact`. `process` reads `rawArtifact` and produces the display variant. `process` must not overwrite `rawArtifact`.

## Test helper conventions (nachweis)

- **`readPbpEntity` in test files must use `parseMarkdownFrontmatter` from `@warpgogol/werkstatt-shared/content`.** Naive line-by-line YAML parsing (splitting on `:` and `JSON.parse`) fails on multi-line YAML that `stringifyMarkdownFrontmatter` produces — nested objects like `consentScope` are written as multi-line YAML maps, not inline JSON. The helper should be: `const { parseMarkdownFrontmatter } = await import("@warpgogol/werkstatt-shared/content"); const { data } = parseMarkdownFrontmatter(raw); return data as Record<string, unknown>;`

## Release pipeline hardcoded values audit (RFC-0980)

- Release pipeline files (`src/release/release-commands.ts`, `src/release/boot-smoke.ts`) must include a `HARDCODED_VALUES_AUDIT` comment block after the `MODULE_CONTRACT`/`CHANGE_SUMMARY` scaffolding.
- The block lists every remaining constant with its classification and justification:
  - **(a) safe default** — runtime/protocol constants, fallbacks used when configuration is missing
  - **(b) workshop-specific** — values specific to this workshop but not to a single site
  - **(c) site-specific** — values that vary per site; must be replaced with dynamic detection (not listed in the block — they are eliminated)
- New constants added to release pipeline files must be documented in the `HARDCODED_VALUES_AUDIT` block.
- The audit report lives at `docs/audits/2026-08-29-release-pipeline-hardcoded-values-audit.md`.

## Leitstand.ship deployment resilience (RFC-0986)

- **`leitstand.ship` MUST skip lifecycle phases (validate, reconcile, close) when the mission is already closed.** `buildShipPlan` reads `mission.yaml` via `checkMissionClosed` before constructing the step list. If `state: closed`, lifecycle steps are filtered out and the plan starts from `release-prepare`. This allows resuming a deployment after a failed `release.prepare` without manually running individual steps. The skip is automatic — no `--skip-step` flags (DNA-73). See `src/leitstand/ship.ts:404-414`, `src/leitstand/ship.ts:345-355`.
- **`leitstand.ship` preflight MUST warn when cache clone and bare repo HEADs have diverged.** The preflight step compares `git rev-parse HEAD` in the cache clone with `git rev-parse master` in the bare repo. When they differ, a non-fatal warning is logged: `WARN cache clone and bare repo have diverged — mirror sync may fail with non-fast-forward`. This makes a pre-existing failure mode visible before deployment starts. See `src/leitstand/ship.ts:176-213`.
- **`sternsystem.sync` and `writeSystemState` MUST use `--force-with-lease` for cache-to-bare push.** The cache clone is the source of truth (RFC-0480 edits-only-through-missions invariant). `--force-with-lease` safely overwrites diverged bare repo history while rejecting the push if the remote HEAD changed unexpectedly. This fixes non-fast-forward errors caused by divergent histories between cache and bare. See `src/sternsystem/sternsystem-sync.ts:106-110`, `src/sternsystem/registry-io.ts:189-191`.
- **`leitstand.ship` MUST auto-sync after `release-prepare` and each `certify-*` step.** `buildShipPlan` inserts `sternsystem.sync` steps after `release-prepare`, `certify-dev`, `certify-alt`, and `certify-main`. These steps prevent the bare repo from falling behind the cache clone during deployment. Sync failure is non-fatal — logged but does not block the pipeline. See `src/leitstand/ship.ts:325-350`.
