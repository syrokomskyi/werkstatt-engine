/*
<MODULE_CONTRACT>
<purpose>RFC-1036: registers scope.* kernel commands for component scope
  lifecycle management. 3 commands: scope.inspect, scope.resolve,
  scope.lifecycle.adopt.</purpose>
<non-goals>
  <item>Does not implement scope logic — that lives in scope.ts.</item>
  <item>Does not register non-scope commands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-1036: initial implementation — registers 3 scope.* commands.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createScopeModule(): Promise<ModuleExport> {
  const { runScopeInspect, runScopeResolve, runScopeLifecycleAdopt } =
    await import("./scope-commands.ts");

  const modulePath = "packages/werkstatt-engine/src/scope/scope.module.ts";
  return {
    name: "scope",
    version: "0.1.0",

    declarations: [],
    commands: [
      {
        name: "scope.inspect",
        modulePath,
        description: "Inspect all active scopes and their component counts and IDs (RFC-1036).",
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        generates: [],
        flags: {},
        execute: runScopeInspect,
      },
      {
        name: "scope.resolve",
        modulePath,
        description:
          "Resolve the active component for a capability in a given scope context. " +
          "Searches innermost-first: per-command → per-mission → per-session → per-workshop → per-fleet. " +
          "Requires --capability and --scope (RFC-1036).",
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        generates: [],
        flags: {
          capability: { kind: "string", description: "Capability ID to resolve." },
          scope: {
            kind: "string",
            description:
              "Component scope (per-command, per-mission, per-session, per-workshop, per-fleet).",
          },
          "mission-id": { kind: "string", description: "Mission ID (for per-mission scope)." },
          "session-id": { kind: "string", description: "Session ID (for per-session scope)." },
          "fleet-id": { kind: "string", description: "Fleet ID (for per-fleet scope)." },
          "invocation-id": {
            kind: "string",
            description: "Command invocation ID (for per-command scope).",
          },
        },
        execute: runScopeResolve,
      },
      {
        name: "scope.lifecycle.adopt",
        modulePath,
        description:
          "Adopt a component into a manual scope (per-fleet or per-session only). " +
          "Requires --component-id and --scope. " +
          "Validates that the component manifest declares the target scope (SCOPE-02 on mismatch) (RFC-1036).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        generates: [],
        flags: {
          "component-id": { kind: "string", description: "Component ID to adopt." },
          scope: { kind: "string", description: "Target scope (per-fleet or per-session only)." },
          "mission-id": {
            kind: "string",
            description: "Mission ID (context for per-mission, not adoptable).",
          },
          "session-id": { kind: "string", description: "Session ID (for per-session scope)." },
          "fleet-id": { kind: "string", description: "Fleet ID (for per-fleet scope)." },
        },
        execute: runScopeLifecycleAdopt,
      },
    ],
    pipelines: [],
  };
}
