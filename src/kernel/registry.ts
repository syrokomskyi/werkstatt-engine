/*
<MODULE_CONTRACT>
<purpose>Facilitates the registration and retrieval of kernel commands and pipelines within the system.</purpose>
<non-goals>
  <item>Do not handle command execution or pipeline orchestration.</item>
  <item>Do not manage raw data parsing or external configuration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
  <item>RFC-1026: add lifecycle-owned registrations — pipelineModules, moduleStates, inFlight, disposedCommandOrigins maps; unregisterModule, trackInFlight, drainInFlight, getModuleState methods; registerPipeline tracks currentModuleName.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandDefinition,
  KernelModuleRegistry,
  KernelPipelineStep,
  ModuleFiberState,
  KernelLifecycleRegistry,
} from "./types.ts";
// @ai-invariant: Command registry must keep command names unique and never bypass typed flag validation.
export class KernelRegistry implements KernelModuleRegistry, KernelLifecycleRegistry {
  readonly commands = new Map<string, KernelCommandDefinition>();
  readonly pipelines = new Map<string, KernelPipelineStep[]>();
  readonly commandModules = new Map<string, string>();
  readonly pipelineModules = new Map<string, string>();
  readonly moduleStates = new Map<string, ModuleFiberState>();
  readonly inFlight = new Map<string, number>();
  readonly disposedCommandOrigins = new Map<string, string>();
  currentModuleName: string | undefined;

  registerCommand(command: KernelCommandDefinition): void {
    const existing = this.commands.get(command.name);
    if (existing) {
      if (existing.execute === command.execute) return;
      throw new Error(
        `Kernel command already registered: ${command.name} (conflict between modules)`,
      );
    }

    this.commands.set(command.name, command);
    if (this.currentModuleName) {
      this.commandModules.set(command.name, this.currentModuleName);
    }
  }

  registerPipeline(name: string, steps: KernelPipelineStep[]): void {
    if (this.pipelines.has(name)) {
      throw new Error(`Kernel pipeline already registered: ${name}`);
    }

    this.pipelines.set(name, [...steps]);
    if (this.currentModuleName) {
      this.pipelineModules.set(name, this.currentModuleName);
    }
  }
  getCommand(name: string): KernelCommandDefinition | undefined {
    return this.commands.get(name);
  }

  getPipeline(name: string): KernelPipelineStep[] | undefined {
    const pipeline = this.pipelines.get(name);
    return pipeline ? [...pipeline] : undefined;
  }

  listCommandNames(): string[] {
    return [...this.commands.keys()].sort();
  }

  getModuleState(moduleName: string): ModuleFiberState | undefined {
    return this.moduleStates.get(moduleName);
  }

  trackInFlight(commandName: string): () => void {
    const count = this.inFlight.get(commandName) ?? 0;
    this.inFlight.set(commandName, count + 1);
    return () => {
      const current = this.inFlight.get(commandName) ?? 0;
      this.inFlight.set(commandName, Math.max(0, current - 1));
    };
  }

  async unregisterModule(moduleName: string): Promise<void> {
    const state = this.moduleStates.get(moduleName);
    if (state === "disposed" || state === undefined) return;

    this.moduleStates.set(moduleName, "draining");

    const moduleCommands = [...this.commandModules.entries()]
      .filter(([, mod]) => mod === moduleName)
      .map(([cmd]) => cmd);

    await this.drainInFlight(moduleCommands);

    this.moduleStates.set(moduleName, "unloading");

    for (const cmd of moduleCommands) {
      this.commands.delete(cmd);
      this.commandModules.delete(cmd);
      this.disposedCommandOrigins.set(cmd, moduleName);
    }

    const modulePipelines = [...this.pipelineModules.entries()]
      .filter(([, mod]) => mod === moduleName)
      .map(([pipe]) => pipe);
    for (const pipe of modulePipelines) {
      this.pipelines.delete(pipe);
      this.pipelineModules.delete(pipe);
    }

    this.moduleStates.set(moduleName, "disposed");
  }

  private async drainInFlight(commandNames: string[]): Promise<void> {
    const timeoutMs = Number(process.env.WERKSTATT_DRAIN_TIMEOUT_MS ?? 30_000);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const allIdle = commandNames.every((cmd) => (this.inFlight.get(cmd) ?? 0) === 0);
      if (allIdle) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    process.stderr.write(
      `[kernel] drain timeout for module commands: ${commandNames.join(", ")}\n`,
    );
  }
}
