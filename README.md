# @warpgogol/werkstatt

[Українська](README.uk.md) | English

Werkstatt engine — stack-agnostic lifecycle platform (RFC-0769/0772).

The engine provides the kernel runtime, mission orchestration, Sternsystem mirror management, release pipelines, Leitstand deploy orchestration, Bordbuch changelog, Notausgang emergency export, artifact store, evidence sync, integrity, observability, fingerprint, agent-gate, and operations schemas. Stack-specific logic (Astro, Phaser, video rendering) is contributed by plugins implementing the `werkstatt/plugin@1` contract (RFC-0770).

## Publication

This package is published to private npm via `@warpgogol/repo-extract`. The extraction configuration lives at [`extract.config.yaml`](./extract.config.yaml). See the [publication runbook](../../docs/authoring/publication-runbook.md) for the full operator-facing procedure.

## Versioning policy

- Engine and plugins version **independently** (SemVer each), but every plugin declares a `peerDependency` on a compatible engine range (e.g. `@warpgogol/werkstatt: ^1.x`).
- Workspace `workspace:*` deps between engine and plugins are rewritten by repo-extract; plugins pin the engine peer range in their own `package.json` explicitly (not `*`).
- Version bumps follow the existing platform version log discipline (`ecosystem.commit`).
- **Breaking engine major → all plugins republished simultaneously.** A breaking contract change (engine major) requires all plugin packages to be updated with the new peerDependency range and republished in the same publication window. Compatible plugins are not silently left on a stale peer range.
- **Workshop version migration.** After full RFC-0769..0779 implementation (all waves complete), the workshop Turborepo package is bumped from version 4 to version 5 to mark the engine extraction milestone.

## Plugin contract

The plugin contract is defined in `src/plugin-contract.ts` (`werkstatt/plugin@1`). A plugin declares `schema`, `id`, `profileId`, `moduleLoaders`, optional `pipelines`, `deployAdapters`, `hooks`, `paths`, and `invariants`. The engine refuses to start with zero or multiple plugins. Validation is via `werkstatt.plugin.validate` (PLUGIN-01..05 failure modes). See RFC-0770 for the full contract specification.
