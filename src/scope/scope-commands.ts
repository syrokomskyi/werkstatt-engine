/*
<MODULE_CONTRACT>
<purpose>RFC-1036: thin kernel command handlers for scope.* commands.
  Each handler delegates to the ScopeManager and wraps the result
  in KernelCommandResult.</purpose>
<non-goals>
  <item>Does not implement scope logic — all logic lives in scope.ts.</item>
  <item>Does not register commands — registration lives in scope.module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1036: initial implementation — 3 scope command handlers.</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";
import type {
  ComponentId,
  CapabilityId,
  ComponentScope,
  ScopeContext,
} from "@warpgogol/werkstatt-shared/component";
import { getDefaultScopeManager } from "./scope.ts";
import { failResult } from "@warpgogol/werkstatt-shared/checks/result-helpers";

function flagString(input: KernelCommandInput, name: string): string {
  const v = input.flags[name];
  return typeof v === "string" ? v : "";
}

function buildScopeContext(input: KernelCommandInput, scope: ComponentScope): ScopeContext {
  const missionId = flagString(input, "mission-id");
  const sessionId = flagString(input, "session-id");
  const fleetId = flagString(input, "fleet-id");
  const invocationId = flagString(input, "invocation-id");
  return {
    scope,
    ...(missionId ? { missionId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(fleetId ? { fleetId } : {}),
    ...(invocationId ? { invocationId } : {}),
  };
}

export async function runScopeInspect(
  _input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const mgr = getDefaultScopeManager();
  const scopes = mgr.inspect();
  return {
    data: {
      scopes: scopes.map((s) => ({
        scope: s.context.scope,
        context: s.context,
        componentCount: s.componentCount,
        components: s.componentIds,
      })),
    },
    exitCode: 0,
    summary: `[scope.commands] ${scopes.length} active scope(s)`,
  };
}

export async function runScopeResolve(
  input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const capability = flagString(input, "capability") as CapabilityId;
  if (!capability) {
    return failResult("scope.commands", ["Missing required flag: --capability"]);
  }
  const scope = flagString(input, "scope") as ComponentScope;
  if (!scope) {
    return failResult("scope.commands", ["Missing required flag: --scope"]);
  }

  const ctx = buildScopeContext(input, scope);
  const mgr = getDefaultScopeManager();
  const resolved = mgr.resolveAcrossScopes(capability, ctx);

  if (!resolved) {
    return {
      data: { resolved: null },
      exitCode: 0,
      summary: `[scope.commands] No provider found for capability '${capability}' in any visible scope`,
    };
  }

  const resolvedScope = mgr.getScope(resolved.componentId);
  return {
    data: {
      resolved: {
        componentId: resolved.componentId,
        scope: resolvedScope,
      },
    },
    exitCode: 0,
    summary: `[scope.commands] Resolved '${capability}' to '${resolved.componentId}' in scope '${resolvedScope}'`,
  };
}

export async function runScopeLifecycleAdopt(
  input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const componentId = flagString(input, "component-id") as ComponentId;
  if (!componentId) {
    return failResult("scope.commands", ["Missing required flag: --component-id"]);
  }
  const scope = flagString(input, "scope") as ComponentScope;
  if (!scope) {
    return failResult("scope.commands", ["Missing required flag: --scope"]);
  }

  const ctx = buildScopeContext(input, scope);
  const mgr = getDefaultScopeManager();

  try {
    mgr.adopt(componentId, ctx);
    return {
      data: { componentId, scope, adopted: true },
      summary: `Adopted '${componentId}' into scope '${scope}'`,
    };
  } catch (err) {
    return failResult("scope.commands", [`Adoption failed: ${(err as Error).message}`]);
  }
}
