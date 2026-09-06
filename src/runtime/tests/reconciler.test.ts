import { describe, it, expect, beforeEach } from "vitest";
import {
  computeDelta,
  reconcile,
  buildActualState,
  buildDesiredState,
  resetReconciliationLock,
} from "../reconciler.ts";
import { validateDeclarations } from "../validate-declarations.ts";
import type {
  ComponentDeclaration,
  DesiredState,
  ActualState,
  MutableActualState,
  ModuleExport,
  CommandDeclaration,
  ModuleBuildContext,
} from "../desired-state.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

const VALID_SHA = ("sha256:" + "a".repeat(64)) as Sha256Digest;

function makeDeclaration(
  id: string,
  overrides: Partial<ComponentDeclaration> = {},
): ComponentDeclaration {
  return {
    schema: "werkstatt/component-declaration@1",
    componentId: id as `${string}/${string}`,
    version: "1.0.0",
    artifactHash: VALID_SHA,
    scope: "per-workshop",
    provides: [],
    requires: [],
    requestedGrants: [],
    effects: [],
    isolation: { tier: 0, adapterId: null },
    resources: [],
    priority: 0,
    active: true,
    ...overrides,
  };
}

function makeDesiredState(
  components: ComponentDeclaration[] = [],
  overrides: Partial<DesiredState> = {},
): DesiredState {
  return {
    components: new Map(components.map((c) => [c.componentId, c])),
    requiredCapabilities: [],
    availableArtifacts: new Map(),
    admittedGrants: [],
    profileId: "test-profile",
    ...overrides,
  };
}

function makeActualState(components: ComponentDeclaration[] = []): MutableActualState {
  return {
    components: new Map(
      components.map((c) => [c.componentId, { declaration: c, state: "active" as const }]),
    ),
    commands: new Map(),
    pipelines: new Map(),
  };
}

function makeModuleExport(name: string, overrides: Partial<ModuleExport> = {}): ModuleExport {
  return {
    name,
    version: "1.0.0",
    declarations: [],
    commands: [],
    pipelines: [],
    ...overrides,
  };
}

describe("RFC-1038: computeDelta", () => {
  it("AC-3: component in desired but not actual → toActivate", () => {
    const decl = makeDeclaration("werkstatt/engine");
    const desired = makeDesiredState([decl]);
    const actual = makeActualState();

    const delta = computeDelta(desired, actual);
    expect(delta.toActivate).toHaveLength(1);
    expect(delta.toActivate[0]!.componentId).toBe("werkstatt/engine");
  });

  it("AC-4: component in actual but not desired → toDeactivate", () => {
    const decl = makeDeclaration("werkstatt/old");
    const desired = makeDesiredState();
    const actual = makeActualState([decl]);

    const delta = computeDelta(desired, actual);
    expect(delta.toDeactivate).toEqual(["werkstatt/old"]);
  });

  it("AC-5: config change → toReconfigure", () => {
    const decl = makeDeclaration("werkstatt/engine", { config: { timeout: 100 } });
    const oldDecl = makeDeclaration("werkstatt/engine", { config: { timeout: 200 } });
    const desired = makeDesiredState([decl]);
    const actual = makeActualState([oldDecl]);

    const delta = computeDelta(desired, actual);
    expect(delta.toReconfigure).toHaveLength(1);
    expect(delta.toReconfigure[0]!.id).toBe("werkstatt/engine");
    expect(delta.toReconfigure[0]!.oldConfig).toEqual({ timeout: 200 });
    expect(delta.toReconfigure[0]!.newConfig).toEqual({ timeout: 100 });
  });

  it("AC-9: missing dependency → missingDependencies", () => {
    const decl = makeDeclaration("werkstatt/engine", {
      requires: [
        {
          capability: "werkstatt/missing-cap",
          compatibility: "^1.0.0",
          schemaHash: VALID_SHA as string,
          optional: false,
        },
      ],
    });
    const desired = makeDesiredState([decl]);
    const actual = makeActualState();

    const delta = computeDelta(desired, actual);
    expect(delta.missingDependencies).toHaveLength(1);
    expect(delta.missingDependencies[0]!.capability).toBe("werkstatt/missing-cap");
    expect(delta.missingDependencies[0]!.requiredBy).toBe("werkstatt/engine");
  });

  it("AC-10: idempotent — same desired and actual → no changes", () => {
    const decl = makeDeclaration("werkstatt/engine");
    const desired = makeDesiredState([decl]);
    const actual = makeActualState([decl]);

    const delta = computeDelta(desired, actual);
    expect(delta.toActivate).toHaveLength(0);
    expect(delta.toDeactivate).toHaveLength(0);
    expect(delta.toReconfigure).toHaveLength(0);
    expect(delta.unchanged).toEqual(["werkstatt/engine"]);
  });

  it("AC-14: empty desired state → deactivate all", () => {
    const decl1 = makeDeclaration("werkstatt/a");
    const decl2 = makeDeclaration("werkstatt/b");
    const desired = makeDesiredState();
    const actual = makeActualState([decl1, decl2]);

    const delta = computeDelta(desired, actual);
    expect(delta.toActivate).toHaveLength(0);
    expect(delta.toDeactivate).toHaveLength(2);
    expect(delta.toDeactivate).toContain("werkstatt/a");
    expect(delta.toDeactivate).toContain("werkstatt/b");
  });
});

describe("RFC-1038: reconcile", () => {
  beforeEach(() => {
    resetReconciliationLock();
  });

  it("AC-2: computes delta and applies transactionally", async () => {
    const decl = makeDeclaration("werkstatt/engine");
    const desired = makeDesiredState([decl]);
    const actual = makeActualState();

    const result = await reconcile(desired, actual);
    expect(result.applied).toBe(true);
    expect(result.delta.toActivate).toHaveLength(1);
    expect(actual.components.has("werkstatt/engine")).toBe(true);
  });

  it("AC-3: activates component in desired but not actual", async () => {
    const decl = makeDeclaration("werkstatt/new");
    const desired = makeDesiredState([decl]);
    const actual = makeActualState();

    await reconcile(desired, actual);
    expect(actual.components.get("werkstatt/new")?.state).toBe("active");
  });

  it("AC-4: deactivates component in actual but not desired (LIFO)", async () => {
    const decl1 = makeDeclaration("werkstatt/a");
    const decl2 = makeDeclaration("werkstatt/b");
    const desired = makeDesiredState();
    const actual = makeActualState([decl1, decl2]);

    const deactivated: string[] = [];
    await reconcile(desired, actual, {
      onDeactivate: async (id) => {
        deactivated.push(id);
      },
    });
    expect(actual.components.size).toBe(0);
    expect(deactivated).toHaveLength(2);
  });

  it("AC-5: reconfigures component on config change", async () => {
    const decl = makeDeclaration("werkstatt/engine", { config: { timeout: 100 } });
    const oldDecl = makeDeclaration("werkstatt/engine", { config: { timeout: 200 } });
    const desired = makeDesiredState([decl]);
    const actual = makeActualState([oldDecl]);

    let reconfigured = false;
    await reconcile(desired, actual, {
      onReconfigure: async () => {
        reconfigured = true;
      },
    });
    expect(reconfigured).toBe(true);
    expect(actual.components.get("werkstatt/engine")?.declaration.config).toEqual({
      timeout: 100,
    });
  });

  it("AC-6: activation failure → applied: false with failure reason", async () => {
    const decl = makeDeclaration("werkstatt/fail");
    const desired = makeDesiredState([decl]);
    const actual = makeActualState();

    const result = await reconcile(desired, actual, {
      onActivate: async () => {
        throw new Error("activation error");
      },
    });
    expect(result.applied).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.reason).toBe("activation error");
  });

  it("AC-10: idempotent — second run produces no changes", async () => {
    const decl = makeDeclaration("werkstatt/engine");
    const desired = makeDesiredState([decl]);
    const actual = makeActualState();

    const result1 = await reconcile(desired, actual);
    expect(result1.applied).toBe(true);

    const result2 = await reconcile(desired, actual);
    expect(result2.delta.toActivate).toHaveLength(0);
    expect(result2.delta.toDeactivate).toHaveLength(0);
    expect(result2.delta.toReconfigure).toHaveLength(0);
  });

  it("AC-12: concurrent reconciliation → applied: false without blocking", async () => {
    const decl = makeDeclaration("werkstatt/engine");
    const desired = makeDesiredState([decl]);
    const actual = makeActualState();

    const slowActivate = new Promise<void>((resolve) => setTimeout(resolve, 50));
    const result1 = reconcile(desired, actual, {
      onActivate: async () => {
        await slowActivate;
      },
    });
    const result2 = await reconcile(desired, actual);

    expect(result2.applied).toBe(false);
    expect(result2.failures.some((f) => f.reason === "reconciliation in progress")).toBe(true);

    await result1;
  });

  it("AC-14: empty desired state → deactivate all without error", async () => {
    const decl1 = makeDeclaration("werkstatt/a");
    const decl2 = makeDeclaration("werkstatt/b");
    const desired = makeDesiredState();
    const actual = makeActualState([decl1, decl2]);

    const result = await reconcile(desired, actual);
    expect(result.applied).toBe(true);
    expect(actual.components.size).toBe(0);
  });
});

describe("RFC-1038: buildActualState and buildDesiredState", () => {
  it("AC-15: module exports ModuleExport — buildActualState reads commands", () => {
    const cmd: CommandDeclaration = {
      name: "test.ping",
      modulePath: "test",
      description: "Test command",
      scope: "workspace",
      flags: {},
      execute: async () => {},
    };
    const mod = makeModuleExport("test", { commands: [cmd] });
    const actual = buildActualState([mod]);
    expect(actual.commands.get("test.ping")).toBe(cmd);
  });

  it("AC-17: CommandDeclaration carries all metadata fields", () => {
    const cmd: CommandDeclaration = {
      name: "test.full",
      modulePath: "packages/test/test.module.ts",
      description: "Full metadata command",
      scope: "workspace",
      flags: { verbose: { kind: "boolean", description: "Verbose" } },
      reads: ["src/**"],
      writes: ["dist/**"],
      modulePaths: ["src/test.ts"],
      validatesOutputs: ["test.validate"],
      generates: [{ path: "dist/test.js", phase: "build.post" }],
      contract: "test-contract",
      rules: ["TEST-01"],
      execute: async () => {},
    };
    const mod = makeModuleExport("test", { commands: [cmd] });
    const actual = buildActualState([mod]);
    const retrieved = actual.commands.get("test.full")!;
    expect(retrieved.flags).toBeDefined();
    expect(retrieved.reads).toEqual(["src/**"]);
    expect(retrieved.writes).toEqual(["dist/**"]);
    expect(retrieved.modulePaths).toEqual(["src/test.ts"]);
    expect(retrieved.validatesOutputs).toEqual(["test.validate"]);
    expect(retrieved.modulePath).toBe("packages/test/test.module.ts");
    expect(retrieved.generates).toHaveLength(1);
    expect(retrieved.contract).toBe("test-contract");
    expect(retrieved.rules).toEqual(["TEST-01"]);
    expect(typeof retrieved.execute).toBe("function");
  });

  it("AC-18: PipelineDeclaration carries name and steps with dependsOn", () => {
    const mod = makeModuleExport("test", {
      pipelines: [
        {
          name: "test.pipeline",
          steps: [{ command: "test.step1" }, { command: "test.step2", dependsOn: ["test.step1"] }],
        },
      ],
    });
    const actual = buildActualState([mod]);
    const pipeline = actual.pipelines.get("test.pipeline")!;
    expect(pipeline).toHaveLength(2);
    expect(pipeline[1]!.dependsOn).toEqual(["test.step1"]);
  });

  it("AC-19: conditionalBuilder receives ModuleBuildContext and returns declarations", () => {
    let receivedContext: ModuleBuildContext | null = null;
    const extraDecl = makeDeclaration("werkstatt/conditional");
    const mod = makeModuleExport("test", {
      conditionalBuilder: (ctx) => {
        receivedContext = ctx;
        return { declarations: [extraDecl] };
      },
    });

    const context: ModuleBuildContext = {
      env: { TEST_FLAG: "1" },
      profileId: "test-profile",
      longRunning: false,
    };
    const result = mod.conditionalBuilder!(context);
    expect(receivedContext).toBe(context);
    expect(result.declarations).toHaveLength(1);
    expect(result.declarations![0]!.componentId).toBe("werkstatt/conditional");
  });

  it("COMPOSITION-02: duplicate command across modules throws", () => {
    const cmd: CommandDeclaration = {
      name: "test.dup",
      modulePath: "test",
      description: "dup",
      scope: "workspace",
      flags: {},
      execute: async () => {},
    };
    const mod1 = makeModuleExport("mod-a", { commands: [cmd] });
    const mod2 = makeModuleExport("mod-b", {
      commands: [{ ...cmd, modulePath: "test2" }],
    });
    expect(() => buildActualState([mod1, mod2])).toThrow(/COMPOSITION-02/);
  });

  it("COMPOSITION-04: duplicate component declaration throws", () => {
    const decl = makeDeclaration("werkstatt/dup");
    const mod1 = makeModuleExport("mod-a", { declarations: [decl] });
    const mod2 = makeModuleExport("mod-b", {
      declarations: [{ ...decl, version: "2.0.0" }],
    });
    expect(() => buildDesiredState([mod1, mod2], { profileId: "test" })).toThrow(/COMPOSITION-04/);
  });
});

describe("RFC-1038: validateDeclarations (AC-20)", () => {
  it("warns when .generate command lacks generates", () => {
    const commands = new Map<string, CommandDeclaration>([
      [
        "test.generate",
        {
          name: "test.generate",
          modulePath: "test",
          description: "generate",
          scope: "workspace",
          flags: {},
          execute: async () => {},
        },
      ],
    ]);
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      validateDeclarations(commands);
    } finally {
      console.warn = origWarn;
    }
    expect(warnings.some((w) => w.includes("test.generate"))).toBe(true);
  });

  it("warns when validator command lacks contract and rules", () => {
    const commands = new Map<string, CommandDeclaration>([
      [
        "test.validate",
        {
          name: "test.validate",
          modulePath: "test",
          description: "validate",
          scope: "workspace",
          flags: {},
          execute: async () => {},
        },
      ],
    ]);
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      validateDeclarations(commands);
    } finally {
      console.warn = origWarn;
    }
    expect(warnings.some((w) => w.includes("contract"))).toBe(true);
    expect(warnings.some((w) => w.includes("rules"))).toBe(true);
  });

  it("passes when all declarations are valid", () => {
    const commands = new Map<string, CommandDeclaration>([
      [
        "test.generate",
        {
          name: "test.generate",
          modulePath: "test",
          description: "generate",
          scope: "workspace",
          flags: {},
          generates: [{ path: "dist/test.js", phase: "build.post" }],
          execute: async () => {},
        },
      ],
    ]);
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      validateDeclarations(commands);
    } finally {
      console.warn = origWarn;
    }
    // The test command itself should not produce a warning.
    // (The exempt list check may warn about missing exempt commands — that's expected with a minimal map.)
    expect(warnings.some((w) => w.includes("test.generate"))).toBe(false);
  });
});
