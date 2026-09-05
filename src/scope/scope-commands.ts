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
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "../kernel/types.ts";
import type {
  ComponentId,
  CapabilityId,
  ComponentScope,
  ScopeContext,
} from "../component/contracts.ts";
import { getDefaultScopeManager } from "./scope.ts";

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
    summary: `${scopes.length} active scope(s)`,
  };
}

export async function runScopeResolve(
  input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const capability = flagString(input, "capability") as CapabilityId;
  if (!capability) {
    return {
      exitCode: 1,
      summary: "Missing required flag: --capability",
    };
  }
  const scope = flagString(input, "scope") as ComponentScope;
  if (!scope) {
    return {
      exitCode: 1,
      summary: "Missing required flag: --scope",
    };
  }

  const ctx = buildScopeContext(input, scope);
  const mgr = getDefaultScopeManager();
  const resolved = mgr.resolveAcrossScopes(capability, ctx);

  if (!resolved) {
    return {
      data: { resolved: null },
      summary: `No provider found for capability '${capability}' in any visible scope`,
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
    summary: `Resolved '${capability}' to '${resolved.componentId}' in scope '${resolvedScope}'`,
  };
}

export async function runScopeLifecycleAdopt(
  input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const componentId = flagString(input, "component-id") as ComponentId;
  if (!componentId) {
    return {
      exitCode: 1,
      summary: "Missing required flag: --component-id",
    };
  }
  const scope = flagString(input, "scope") as ComponentScope;
  if (!scope) {
    return {
      exitCode: 1,
      summary: "Missing required flag: --scope",
    };
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
    return {
      exitCode: 1,
      summary: `Adoption failed: ${(err as Error).message}`,
    };
  }
}
