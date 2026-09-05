/*
<MODULE_CONTRACT>
<purpose>RFC-1036: ScopeManager implementation — manages scoped component registries
with lifecycle-owned creation and disposal. Five scopes: per-command, per-mission,
per-session, per-workshop, per-fleet. Resolution searches innermost-first.</purpose>
<non-goals>
  <item>Does not implement distributed fleet-wide synchronization — per-fleet uses local registry with HTTP fetch extension point.</item>
  <item>Does not implement periodic sweep — sweep is a future extension for long-running modes.</item>
  <item>Does not implement session timeout — sessions are disposed explicitly or via context.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-1036: initial implementation of ScopeManager, ScopedRegistry, ScopeError.</item>
</CHANGE_SUMMARY>
*/

import type {
  ComponentId,
  CapabilityId,
  ComponentManifestV1,
  ComponentScope,
  ScopeContext,
  ScopedRegistry,
  ScopeManager,
} from "../component/contracts.ts";
import { SCOPE_ERROR_CODES } from "../component/contracts.ts";

const DEFAULT_REGISTRY_LIMIT = 64;

const SCOPE_RESOLUTION_ORDER: readonly ComponentScope[] = [
  "per-command",
  "per-mission",
  "per-session",
  "per-workshop",
  "per-fleet",
];

const MANUAL_SCOPES: readonly ComponentScope[] = ["per-fleet", "per-session"];

export class ScopeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "ScopeError";
    this.code = code;
  }
}

function scopeContextKey(ctx: ScopeContext): string {
  const parts: string[] = [ctx.scope];
  if (ctx.missionId) parts.push(`mission:${ctx.missionId}`);
  if (ctx.sessionId) parts.push(`session:${ctx.sessionId}`);
  if (ctx.fleetId) parts.push(`fleet:${ctx.fleetId}`);
  if (ctx.invocationId) parts.push(`invocation:${ctx.invocationId}`);
  return parts.join("|");
}

interface RegistryEntry {
  readonly manifest: ComponentManifestV1;
  readonly registeredAt: number;
}

class ScopedRegistryImpl implements ScopedRegistry {
  readonly context: ScopeContext;
  private readonly components = new Map<ComponentId, RegistryEntry>();
  private readonly order: ComponentId[] = [];
  private disposed = false;

  constructor(context: ScopeContext) {
    this.context = context;
  }

  register(manifest: ComponentManifestV1): void {
    if (this.disposed) {
      throw new ScopeError(
        SCOPE_ERROR_CODES.SCOPE_01,
        `registry for scope '${this.context.scope}' is disposed`,
      );
    }
    if (!manifest.scope) {
      throw new ScopeError(
        SCOPE_ERROR_CODES.SCOPE_03,
        "component manifest missing required scope field",
      );
    }
    if (manifest.scope !== this.context.scope) {
      throw new ScopeError(
        SCOPE_ERROR_CODES.SCOPE_01,
        `manifest declares scope '${manifest.scope}' but registry is '${this.context.scope}'`,
      );
    }
    if (this.components.has(manifest.componentId)) {
      throw new ScopeError(
        SCOPE_ERROR_CODES.SCOPE_01,
        `component '${manifest.componentId}' already registered in scope '${this.context.scope}'`,
      );
    }
    this.components.set(manifest.componentId, {
      manifest,
      registeredAt: Date.now(),
    });
    this.order.push(manifest.componentId);
  }

  resolve(capabilityId: CapabilityId): ComponentManifestV1 | null {
    if (this.disposed) return null;
    for (const entry of this.components.values()) {
      for (const provide of entry.manifest.provides) {
        if (provide.capability === capabilityId) {
          return entry.manifest;
        }
      }
    }
    return null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // LIFO order — reverse of registration
    for (let i = this.order.length - 1; i >= 0; i--) {
      const id = this.order[i];
      this.components.delete(id);
    }
    this.order.length = 0;
  }

  list(): ReadonlyArray<ComponentManifestV1> {
    return this.order.map((id) => this.components.get(id)!.manifest);
  }

  getScope(): ComponentScope {
    return this.context.scope;
  }

  hasComponent(componentId: ComponentId): boolean {
    return this.components.has(componentId);
  }

  getManifest(componentId: ComponentId): ComponentManifestV1 | null {
    const entry = this.components.get(componentId);
    return entry ? entry.manifest : null;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

export interface ScopeManagerOptions {
  readonly registryLimit?: number;
}

export function createScopeManager(options: ScopeManagerOptions = {}): ScopeManager {
  const limit = options.registryLimit ?? DEFAULT_REGISTRY_LIMIT;
  const registries = new Map<string, ScopedRegistryImpl>();

  function findRegistry(ctx: ScopeContext): ScopedRegistryImpl | undefined {
    return registries.get(scopeContextKey(ctx));
  }

  function getOrCreateRegistry(ctx: ScopeContext): ScopedRegistryImpl {
    const key = scopeContextKey(ctx);
    const existing = registries.get(key);
    if (existing && !existing.isDisposed) return existing;

    if (registries.size >= limit) {
      const allActive = Array.from(registries.values()).every((r) => !r.isDisposed);
      if (allActive) {
        throw new ScopeError(
          SCOPE_ERROR_CODES.SCOPE_04,
          `registry limit reached (${limit} active registries)`,
        );
      }
    }
    const registry = new ScopedRegistryImpl(ctx);
    registries.set(key, registry);
    return registry;
  }

  function resolveInScope(
    capabilityId: CapabilityId,
    ctx: ScopeContext,
  ): ComponentManifestV1 | null {
    const registry = findRegistry(ctx);
    if (!registry || registry.isDisposed) return null;
    return registry.resolve(capabilityId);
  }

  function buildResolutionContexts(ctx: ScopeContext): ScopeContext[] {
    const contexts: ScopeContext[] = [];
    const startIdx = SCOPE_RESOLUTION_ORDER.indexOf(ctx.scope);
    for (let i = startIdx; i < SCOPE_RESOLUTION_ORDER.length; i++) {
      const scope = SCOPE_RESOLUTION_ORDER[i]!;
      if (scope === "per-command" && ctx.invocationId) {
        contexts.push({ scope, invocationId: ctx.invocationId });
      } else if (scope === "per-mission" && ctx.missionId) {
        contexts.push({ scope, missionId: ctx.missionId });
      } else if (scope === "per-session" && ctx.sessionId) {
        contexts.push({ scope, sessionId: ctx.sessionId });
      } else if (scope === "per-workshop") {
        contexts.push({ scope });
      } else if (scope === "per-fleet" && ctx.fleetId) {
        contexts.push({ scope, fleetId: ctx.fleetId });
      }
    }
    return contexts;
  }

  const manager: ScopeManager = {
    getRegistry(ctx: ScopeContext): ScopedRegistry {
      return getOrCreateRegistry(ctx);
    },

    disposeRegistry(ctx: ScopeContext): void {
      const registry = findRegistry(ctx);
      if (registry) {
        registry.dispose();
        registries.delete(scopeContextKey(ctx));
      }
    },

    resolveAcrossScopes(capabilityId: CapabilityId, ctx: ScopeContext): ComponentManifestV1 | null {
      const contexts = buildResolutionContexts(ctx);
      for (const c of contexts) {
        const result = resolveInScope(capabilityId, c);
        if (result) return result;
      }
      return null;
    },

    inspect(): ReadonlyArray<{
      context: ScopeContext;
      componentCount: number;
      componentIds: ComponentId[];
    }> {
      const result: Array<{
        context: ScopeContext;
        componentCount: number;
        componentIds: ComponentId[];
      }> = [];
      for (const registry of registries.values()) {
        if (registry.isDisposed) continue;
        result.push({
          context: registry.context,
          componentCount: registry.list().length,
          componentIds: registry.list().map((m) => m.componentId),
        });
      }
      return result;
    },

    adopt(componentId: ComponentId, targetContext: ScopeContext): void {
      if (!MANUAL_SCOPES.includes(targetContext.scope)) {
        throw new ScopeError(
          SCOPE_ERROR_CODES.SCOPE_02,
          `adopt is only for manual scopes (per-fleet, per-session), not '${targetContext.scope}'`,
        );
      }

      let manifest: ComponentManifestV1 | null = null;
      for (const registry of registries.values()) {
        if (registry.isDisposed) continue;
        const found = registry.getManifest(componentId);
        if (found) {
          manifest = found;
          break;
        }
      }

      if (!manifest) {
        throw new ScopeError(
          SCOPE_ERROR_CODES.SCOPE_01,
          `component '${componentId}' not found in any scope`,
        );
      }

      if (manifest.scope !== targetContext.scope) {
        throw new ScopeError(
          SCOPE_ERROR_CODES.SCOPE_02,
          `scope mismatch — manifest declares '${manifest.scope}' but adoption targets '${targetContext.scope}'`,
        );
      }

      const targetRegistry = getOrCreateRegistry(targetContext);
      targetRegistry.register(manifest);
    },

    getScope(componentId: ComponentId): ComponentScope | null {
      for (const registry of registries.values()) {
        if (registry.isDisposed) continue;
        if (registry.hasComponent(componentId)) {
          return registry.getScope();
        }
      }
      return null;
    },
  };

  return manager;
}

let defaultManager: ScopeManager | null = null;

export function getDefaultScopeManager(): ScopeManager {
  if (!defaultManager) {
    const limit = Number(process.env.WERKSTATT_SCOPE_REGISTRY_LIMIT) || DEFAULT_REGISTRY_LIMIT;
    defaultManager = createScopeManager({ registryLimit: limit });
  }
  return defaultManager;
}

export function resetDefaultScopeManager(): void {
  defaultManager = null;
}
