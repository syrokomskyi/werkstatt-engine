/*
<MODULE_CONTRACT>
<purpose>RFC-1031: registers evolution.candidate.* kernel commands for the
  governed capability evolution controller. 9 commands covering the full
  candidate lifecycle: define, shadow, test, canary, activate, promote,
  rollback, quarantine, inspect.</purpose>
<non-goals>
  <item>Does not implement evolution logic — that lives in controller.ts.</item>
  <item>Does not register non-evolution commands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1031: initial implementation — registers 9 evolution.candidate.* commands.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createEvolutionModule(): Promise<ModuleExport> {
  const {
    runCandidateDefine,
    runCandidateShadow,
    runCandidateTest,
    runCandidateCanary,
    runCandidateActivate,
    runCandidatePromote,
    runCandidateRollback,
    runCandidateQuarantine,
    runCandidateInspect,
  } = await import("./evolution-commands.ts");

  const modulePath = "packages/werkstatt-engine/src/evolution/evolution.module.ts";
  return {
    name: "evolution",
    version: "0.1.0",

    declarations: [],
    commands: [
      {
        name: "evolution.candidate.define",
        modulePath,
        description:
          "Register a new capability candidate in the defined state. " +
          "Requires --component-id, --version, --artifact (content-addressed hash). " +
          "Optional --allow-agent-written flag for agent-authored candidates (RFC-1031).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "component-id": { kind: "string", description: "Component ID for the candidate." },
          version: { kind: "string", description: "Semantic version of the candidate." },
          artifact: {
            kind: "string",
            description: "Content-addressed artifact hash (sha256:...).",
          },
          "allow-agent-written": {
            kind: "boolean",
            description: "Allow agent-authored candidates (default: false).",
          },
        },
        execute: runCandidateDefine,
      },
      {
        name: "evolution.candidate.shadow",
        modulePath,
        description:
          "Run candidate alongside active component in shadow mode. " +
          "Parallel invocation with comparison metric. Records CandidateEvidenceV1 (RFC-1031).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "candidate-id": { kind: "string", description: "Candidate ID to shadow." },
          metric: { kind: "string", description: "Comparison metric (default: latency)." },
        },
        execute: runCandidateShadow,
      },
      {
        name: "evolution.candidate.test",
        modulePath,
        description:
          "Run held-out evaluation scenarios against the candidate. " +
          "Records CandidateEvidenceV1 for each scenario (RFC-1031).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "candidate-id": { kind: "string", description: "Candidate ID to test." },
          scenarios: {
            kind: "string",
            description: "Path to evaluation scenarios (default: src/evolution/fixtures).",
          },
        },
        execute: runCandidateTest,
      },
      {
        name: "evolution.candidate.canary",
        modulePath,
        description:
          "Route a percentage of traffic to the candidate via deterministic hash routing. " +
          "Uses Sha256Digest of canonical JSON input bytes (RFC-0849, RFC-1031).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "candidate-id": { kind: "string", description: "Candidate ID to canary." },
          "traffic-percent": {
            kind: "string",
            description: "Percentage of traffic to route (default: 10).",
          },
        },
        execute: runCandidateCanary,
      },
      {
        name: "evolution.candidate.activate",
        modulePath,
        description:
          "Atomically replace the active component with the candidate. " +
          "Uses ActivationTransaction for atomic replacement (RFC-1031).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "candidate-id": { kind: "string", description: "Candidate ID to activate." },
        },
        execute: runCandidateActivate,
      },
      {
        name: "evolution.candidate.promote",
        modulePath,
        description:
          "Promote the candidate to permanent status via the mission/release pipeline. " +
          "Creates a mission with the candidate artifact (RFC-1031).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "candidate-id": { kind: "string", description: "Candidate ID to promote." },
          "mission-id": { kind: "string", description: "Mission ID for the promotion pipeline." },
        },
        execute: runCandidatePromote,
      },
      {
        name: "evolution.candidate.rollback",
        modulePath,
        description:
          "Reactivate the previous component and transition the candidate to rolled-back. " +
          "Used when a promoted candidate needs to be reverted (RFC-1031).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "component-id": { kind: "string", description: "Component ID to roll back." },
        },
        execute: runCandidateRollback,
      },
      {
        name: "evolution.candidate.quarantine",
        modulePath,
        description:
          "Transition candidate to quarantined state. " +
          "Triggered automatically after 3 consecutive health check failures or manually (RFC-1031).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "candidate-id": { kind: "string", description: "Candidate ID to quarantine." },
          reason: { kind: "string", description: "Reason for quarantine (default: unspecified)." },
        },
        execute: runCandidateQuarantine,
      },
      {
        name: "evolution.candidate.inspect",
        modulePath,
        description:
          "Inspect all registered candidates with their states and transition history. " +
          "Returns JSON array of CapabilityCandidateV1 (RFC-1031).",
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        generates: [],
        execute: runCandidateInspect,
      },
    ],
    pipelines: [],
  };
}
